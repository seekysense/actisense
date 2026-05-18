"""Unit tests for _resolve_webhook() in engine/main.py."""
from engine.main import _resolve_webhook


class _Area:
    def __init__(self, url):
        self.webhook_url = url


class _Site:
    def __init__(self, url):
        self.webhook_url = url


class _Cfg:
    def __init__(self, url):
        self.site = _Site(url)


ENV_DEFAULT = "http://env/hook"


def test_area_url_takes_priority():
    assert _resolve_webhook(_Area("http://area/hook"), _Cfg("http://site/hook"), ENV_DEFAULT) == "http://area/hook"


def test_site_url_fallback_when_area_none():
    assert _resolve_webhook(_Area(None), _Cfg("http://site/hook"), ENV_DEFAULT) == "http://site/hook"


def test_env_fallback_when_both_none():
    assert _resolve_webhook(_Area(None), _Cfg(None), ENV_DEFAULT) == ENV_DEFAULT


def test_area_empty_string_not_used():
    # empty string is falsy — falls through to site
    assert _resolve_webhook(_Area(""), _Cfg("http://site/hook"), ENV_DEFAULT) == "http://site/hook"


def test_none_area_cfg_falls_through_to_site():
    assert _resolve_webhook(None, _Cfg("http://site/hook"), ENV_DEFAULT) == "http://site/hook"


def test_none_area_and_none_site_falls_through_to_env():
    assert _resolve_webhook(None, _Cfg(None), ENV_DEFAULT) == ENV_DEFAULT


def test_none_cfg_falls_through_to_env():
    assert _resolve_webhook(None, None, ENV_DEFAULT) == ENV_DEFAULT
