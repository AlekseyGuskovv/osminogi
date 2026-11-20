import re


# Preserve line positions and string literals while removing Kotlin comments.
TOKENS = re.compile(r'"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*')


def kotlin_source(text: str, *, keep_strings: bool = True) -> str:
    return TOKENS.sub(lambda match: re.sub(r"[^\n]", " ", match[0])
                      if not keep_strings or match[0].startswith(("//", "/*")) else match[0], text)


def line_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1
