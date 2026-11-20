import argparse
import json
import os
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class DeliveryError(RuntimeError):
    pass


def call_telegram(method, payload, token=None):
    token = (token or os.environ.get("GARDEN_TELEGRAM_BOT_TOKEN", "")).strip()
    if not token:
        raise DeliveryError("Токен Telegram не настроен.")
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", token):
        raise DeliveryError("Токен Telegram имеет неверный формат.")
    request = Request(f"https://api.telegram.org/bot{token}/{method}",
                      json.dumps(payload).encode(), {"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=15) as response:
            result = json.loads(response.read(1024 * 1024))
        if result.get("ok") is not True:
            raise DeliveryError("Telegram отклонил запрос.")
        return result["result"]
    except HTTPError as error:
        error.close()
        raise DeliveryError(f"Telegram отклонил запрос (HTTP {error.code}).") from None
    except (OSError, ValueError, KeyError):
        raise DeliveryError("Не удалось получить ответ Telegram.") from None


def send_report(report, *, token=None, chat_id=None):
    chat_id = (chat_id or os.environ.get("GARDEN_TELEGRAM_CHAT_ID", "")).strip()
    if not chat_id:
        raise DeliveryError("ID закрытого Telegram-чата не задан.")
    result = call_telegram("sendMessage", {"chat_id": chat_id, "text": report[:3800]}, token=token)
    message_id = result.get("message_id") if isinstance(result, dict) else None
    if type(message_id) is not int:
        raise DeliveryError("Telegram не подтвердил доставку отчёта.")
    return message_id


def discover_chats():
    result = call_telegram("getUpdates", {"limit": 100, "allowed_updates": ["message", "my_chat_member", "channel_post"]})
    chats = {}
    for update in result:
        message = update.get("message") or update.get("my_chat_member") or update.get("channel_post") or {}
        chat = message.get("chat", {})
        if chat.get("type") in ("group", "supergroup", "channel"):
            chats[chat["id"]] = {"chatId": chat["id"], "title": chat.get("title", "")}
    return list(chats.values())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Find groups visible to the configured Telegram bot")
    parser.add_argument("--discover", action="store_true", required=True)
    parser.parse_args()
    try:
        print(json.dumps(discover_chats(), ensure_ascii=True))
    except DeliveryError as error:
        parser.exit(1, str(error) + "\n")
