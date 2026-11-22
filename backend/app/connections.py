import os
import re
from threading import Lock
from uuid import uuid4

from .contract import ApiError
from .telegram import DeliveryError, send_report


ENV_ID = "telegram-env"
KEY_LOCK = Lock()


def cipher(store, *, create=False):
    try:
        from cryptography.fernet import Fernet
        key = os.environ.get("GARDEN_CONNECTION_KEY")
        if key:
            return Fernet(key.encode())
        path = store.path.with_suffix(store.path.suffix + ".garden-key")
        with KEY_LOCK:
            if path.is_file():
                return Fernet(path.read_bytes().strip())
            if not create or store.list("connection", 1):
                raise ApiError(503, "CONNECTION_KEY_REQUIRED", "Восстановите исходный ключ шифрования Telegram.")
            key_bytes = Fernet.generate_key()
            try:
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                return Fernet(path.read_bytes().strip())
            with os.fdopen(descriptor, "wb") as output:
                output.write(key_bytes)
            return Fernet(key_bytes)
    except ApiError:
        raise
    except (ImportError, OSError, ValueError) as error:
        raise ApiError(503, "CONNECTION_ENCRYPTION_UNAVAILABLE", "Проверьте ключ и зависимости шифрования.") from error


def public(row):
    return {"id": row["id"], "name": row["name"], "type": "telegram", "configured": not row.get("disabled", False)}


def connections(store):
    result = [public(row) for row in store.list("connection")]
    if all(os.environ.get(name) for name in ("GARDEN_TELEGRAM_CHAT_ID", "GARDEN_TELEGRAM_BOT_TOKEN")):
        result.append(public({"id": ENV_ID, "name": "Закрытый чат сервера"}))
    return result


def encrypt_credentials(store, token, chat_id, *, create=False):
    if (not isinstance(token, str) or not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,100}", token)
            or not isinstance(chat_id, (str, int)) or not re.fullmatch(r"-?\d{1,20}", str(chat_id))):
        raise ApiError(422, "INVALID_CONNECTION", "Укажите название, токен бота и числовой ID чата.")
    return cipher(store, create=create).encrypt(f"{chat_id}\n{token}".encode()).decode()


def connection_name(name):
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 100:
        raise ApiError(422, "INVALID_CONNECTION", "Укажите название подключения длиной от 1 до 100 символов.")
    return name.strip()


def save_connection(store, data):
    if data.get("type") != "telegram":
        raise ApiError(422, "INVALID_CONNECTION", "Выберите подключение Telegram.")
    key = uuid4().hex
    row = {"id": key, "name": connection_name(data.get("name")),
           "secret": encrypt_credentials(store, data.get("token"), data.get("chatId"), create=True)}
    store.put("connection", key, row)
    return public(row)


def update_connection(store, key, data):
    if key == ENV_ID:
        raise ApiError(409, "SERVER_CONNECTION", "Это подключение задаётся настройками сервера.")
    changes = {}
    if "name" in data:
        changes["name"] = connection_name(data["name"])
    if "token" in data or "chatId" in data:
        changes["secret"] = encrypt_credentials(store, data.get("token"), data.get("chatId"))
    if "configured" in data:
        if type(data["configured"]) is not bool:
            raise ApiError(422, "INVALID_CONNECTION", "Укажите состояние подключения.")
        changes["disabled"] = not data["configured"]
    row = store.patch("connection", key, changes)
    if row is None:
        raise ApiError(404, "CONNECTION_NOT_FOUND", "Подключение Telegram не найдено.")
    return public(row)


def send_connection_test(store, key):
    row = next((item for item in connections(store) if item["id"] == key), None)
    if row is None:
        raise ApiError(404, "CONNECTION_NOT_FOUND", "Подключение Telegram не найдено.")
    if not row["configured"]:
        raise ApiError(409, "CONNECTION_DISABLED", "Включите подключение перед проверкой.")
    try:
        return {"messageId": deliver(store, {"channelId": key}, "Cyber Garden · тестовое сообщение.")}
    except DeliveryError as error:
        raise ApiError(502, "TELEGRAM_TEST_FAILED", str(error)) from None


def deliver(store, node, report):
    if "channelId" not in node or node["channelId"] == ENV_ID:
        return send_report(report)
    key = node["channelId"]
    row = store.get("connection", key) if isinstance(key, str) else None
    if not row:
        raise DeliveryError("CONNECTION_REQUIRED: Выберите подключение Telegram.")
    if row.get("disabled"):
        raise DeliveryError("Подключение Telegram отключено в настройках.")
    try:
        chat, token = cipher(store).decrypt(row["secret"].encode()).decode().split("\n", 1)
    except Exception:
        raise DeliveryError("Не удалось открыть настройки подключения Telegram.") from None
    return send_report(report, token=token, chat_id=chat)
