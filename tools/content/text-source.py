"""Small, inert HTML reader for the full-text import tools (no browser/JS)."""
from __future__ import annotations

from html.parser import HTMLParser
import re


class Node:
    def __init__(self, tag="root", attrs=(), parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children: list[Node | str] = []

    def all(self, tag=None, cls=None, id=None):
        for child in self.children:
            if isinstance(child, Node):
                if ((tag is None or child.tag == tag)
                    and (cls is None or cls in child.attrs.get("class", "").split())
                    and (id is None or child.attrs.get("id") == id)):
                    yield child
                yield from child.all(tag, cls, id)

    def one(self, **query):
        return next(self.all(**query), None)

    def text(self, blocks=False):
        if self.tag in {"script", "style", "noscript"}:
            return ""
        value = "".join(c.text(blocks) if isinstance(c, Node) else c for c in self.children)
        if blocks and self.tag in {"p", "div", "blockquote", "section", "h1", "h2", "h3", "h4", "li", "tr"}:
            value = "\n\n" + value + "\n\n"
        if blocks and self.tag in {"br", "hr"}:
            value = "\n" + value
        return value


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.current = self.root
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in self.VOID:
            self.current = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node.parent is not None:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)


def clean_text(text):
    text = text.replace("\xa0", " ").replace("\u200b", "").replace("\ufeff", "")
    text = text.replace("Ð", "Đ").replace("ð", "đ")
    lines = [re.sub(r"[^\S\n]+", " ", line).strip() for line in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def plain(node):
    return clean_text(node.text()) if node else ""
