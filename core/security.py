# core/security.py
from __future__ import annotations
from urllib.parse import urlparse
import ipaddress
import socket

def _is_private_host(host: str) -> bool:
    try:
        # se for IP literal
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        pass

    # resolve DNS
    try:
        infos = socket.getaddrinfo(host, None)
        for family, _, _, _, sockaddr in infos:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return True
    except Exception:
        # se não conseguir resolver, seja conservador (pode trocar pra False se preferir)
        return True

    return False

def validate_public_http_url(url: str) -> None:
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ValueError("Only http/https URLs are allowed.")
    if not p.hostname:
        raise ValueError("Invalid URL (no hostname).")
    if _is_private_host(p.hostname):
        raise ValueError("Private/localhost URLs are not allowed.")