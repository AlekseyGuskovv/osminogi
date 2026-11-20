import os
import re
from uuid import uuid4

from .contract import ApiError
from .telegram import DeliveryError, send_report


ENV_ID = "telegram-env"


def cipher():
    key = os.environ.get("GARDEN_CONNECTION_KEY")
    if not key:
        raise ApiError(503, "CONNECTION_KEY_REQUIRED", "Настройте серверный ключ шифрования Telegram.")
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode())
    except (ImportError, ValueError) as error:
        raise ApiError(503, "CONNECTION_ENCRYPTION_UNAVAILABLE", "Проверьте ключ и зависимости шифрования.") from error


def public(row):
    return {"id": row["id"], "name": row["name"], "type": "telegram", "configured": True}


def connections(store):
    result = [public(row) for row in store.list("connection")]
    if all(os.environ.get(name) for name in ("GARDEN_TELEGRAM_CHAT_ID", "GARDEN_TELEGRAM_BOT_TOKEN")):
        result.append(public({"id": ENV_ID, "name": "Закрытый чат сервера"}))
    return result


def save_connection(store, data):
    kind, name, token, chat_id = (data.get(key) for key in ("type", "name", "token", "chatId"))
    if (kind != "telegram" or not isinstance(name, str) or not 0 < len(name.strip()) <= 100
            or not isinstance(token, str) or not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,100}", token)
            or not isinstance(chat_id, (str, int)) or not re.fullmatch(r"-?\d{1,20}", str(chat_id))):
        raise ApiError(422, "INVALID_CONNECTION", "Укажите название, токен бота и числовой ID чата.")
    key = uuid4().hex
    row = {"id": key, "name": name.strip(),
           "secret": cipher().encrypt(f"{chat_id}\n{token}".encode()).decode()}
    store.put("connection", key, row)
    return public(row)


def deliver(store, node, report):
    if "channelId" not in node or node["channelId"] == ENV_ID:
        return send_report(report)
    key = node["channelId"]
    row = store.get("connection", key) if isinstance(key, str) else None
    if not row:
        raise DeliveryError("CONNECTION_REQUIRED: Выберите подключение Telegram.")
    try:
        chat, token = cipher().decrypt(row["secret"].encode()).decode().split("\n", 1)
    except Exception:
        raise DeliveryError("Не удалось открыть настройки подключения Telegram.") from None
    return send_report(report, token=token, chat_id=chat)