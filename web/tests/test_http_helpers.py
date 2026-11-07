"""W3 transport characterization; no router, DB, network or app startup imports.

The frozen pre-move implementation is the differential oracle. Real Starlette
responses exercise cookie serialization; recording uploads isolate the existing
support-service boundary, rather than pretending to test image-domain policy.
"""

import ast
import asyncio
from datetime import datetime, timezone
import importlib.util
from io import BytesIO
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import pytest
from fastapi import Response, UploadFile
import starlette.responses

from APP.exceptions import ErrorCode, ValidationError


WEB = Path(__file__).resolve().parents[1]
FROZEN = Path(__file__).parent / "fixtures" / "http_helpers_before_w3.py"


def load_source(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def helpers(monkeypatch):
    settings = SimpleNamespace(app=SimpleNamespace(cookie_secure=False))
    config = ModuleType("APP.config")
    config.settings = settings
    service = ModuleType("APP.services.support_service")
    service.MAX_IMAGE_BYTES = 10 * 1024 * 1024
    service.Image = object
    services = ModuleType("APP.services")
    services.support_service = service
    # The actual moved source is loaded, but its existing settings/service edges
    # are test-only fakes. In particular the real support service imports DB models.
    with monkeypatch.context() as imports:
        imports.setitem(sys.modules, "APP.config", config)
        imports.setitem(sys.modules, "APP.services", services)
        imports.setitem(sys.modules, "APP.services.support_service", service)
        cookies = load_source(WEB / "API/http/auth_cookies.py", "w3_auth_cookies")
        support = load_source(WEB / "API/http/support_inputs.py", "w3_support_inputs")
    frozen = load_source(FROZEN, "w3_frozen_http_helpers")
    frozen.settings = settings
    frozen.svc = service
    frozen.ValidationError = ValidationError
    frozen.ErrorCode = ErrorCode
    return SimpleNamespace(cookies=cookies, support=support, frozen=frozen, settings=settings, service=service)


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2030, 1, 2, 3, 4, 5, tzinfo=timezone.utc).astimezone(tz)


@pytest.mark.parametrize("secure", [False, True])
@pytest.mark.parametrize("ttl", [0, -1, 1, 30])
@pytest.mark.parametrize("token", ["plain-token", "", 'a b;"\\'])
def test_auth_cookie_exact_headers_and_order(helpers, monkeypatch, secure, ttl, token):
    monkeypatch.setattr(starlette.responses, "datetime", FixedDatetime)
    monkeypatch.setattr("time.time", lambda: FixedDatetime.now(timezone.utc).timestamp())
    helpers.settings.app.cookie_secure = secure
    responses = []
    for implementation in (helpers.frozen, helpers.cookies):
        response = Response(headers={"X-Before": "kept"})
        response.set_cookie("other", "untouched")
        implementation._set_rt_cookie(response, token, ttl)
        implementation.clear_rt_cookie(response)
        responses.append(response)
    assert responses[0].raw_headers == responses[1].raw_headers
    headers = responses[1].headers.getlist("set-cookie")
    assert len(headers) == 3
    assert headers[0] == "other=untouched; Path=/; SameSite=lax"
    assert f"; HttpOnly; Max-Age={ttl * 86400}; Path=/api/v1/auth; SameSite=lax" in headers[1]
    assert headers[1].endswith("; Secure") is secure
    assert headers[1].startswith("rt=")
    assert "Domain=" not in headers[1] and "expires=" not in headers[1]
    # Deletion deliberately retains Starlette defaults, NOT the set-cookie flags.
    assert headers[2] == (
        'rt=""; expires=Wed, 02 Jan 2030 03:04:05 GMT; Max-Age=0; '
        'Path=/api/v1/auth; SameSite=lax'
    )
    assert responses[1].raw_headers[:2] == [(b"x-before", b"kept"), (b"content-length", b"0")]


@pytest.mark.parametrize("token,ttl,error", [("snowman-\u2603", 1, UnicodeEncodeError), ("token", None, TypeError)])
def test_auth_cookie_serialization_errors_leave_headers_unchanged(helpers, token, ttl, error):
    failures = []
    for implementation in (helpers.frozen, helpers.cookies):
        response = Response()
        before = list(response.raw_headers)
        with pytest.raises(error) as caught:
            implementation._set_rt_cookie(response, token, ttl)
        assert response.raw_headers == before
        failures.append((type(caught.value), caught.value.args))
    assert failures[0] == failures[1]


class RecordingUpload:
    def __init__(self, filename, data, events, failure=None, content_type="image/png"):
        self.filename = filename
        self.data = data
        self.events = events
        self.failure = failure
        self._content_type = content_type

    async def read(self, size):
        self.events.append(("read", size))
        if self.failure is not None:
            raise self.failure
        return self.data

    @property
    def content_type(self):
        self.events.append(("content_type",))
        return self._content_type


def test_support_read_image_skips_absent_filename_and_empty_data(helpers):
    for implementation in (helpers.frozen, helpers.support):
        events = []
        helpers.service.sniff_image = lambda *args: pytest.fail("sniff must not run")
        assert asyncio.run(implementation.read_image(None)) is None
        for filename in (None, ""):
            assert asyncio.run(implementation.read_image(RecordingUpload(filename, b"data", events))) is None
        assert events == []
        assert asyncio.run(implementation.read_image(RecordingUpload("a.png", b"", events))) is None
        assert events == [("read", 10485761)]


@pytest.mark.parametrize("filename", ["a.png", " ", "../../arbitrary.exe"])
@pytest.mark.parametrize("declared", [None, "", "image/png", "application/octet-stream", "wrong/type"])
def test_support_read_image_exact_delegation_and_order(helpers, filename, declared):
    snapshots = []
    for implementation in (helpers.frozen, helpers.support):
        events = []
        data = b"not interpreted by the transport"
        image = object()

        def sniff(payload, content_type):
            events.append(("sniff", payload, content_type))
            assert payload is data
            return image

        helpers.service.sniff_image = sniff
        upload = RecordingUpload(filename, data, events, content_type=declared)
        assert asyncio.run(implementation.read_image(upload)) is image
        snapshots.append(events)
    assert snapshots[0] == snapshots[1] == [
        ("read", 10485761), ("content_type",), ("sniff", data, declared)
    ]


@pytest.mark.parametrize("size", [10485760, 10485761, 10485762])
def test_support_upload_read_is_bounded_and_leaves_tail_unread(helpers, size):
    for implementation in (helpers.frozen, helpers.support):
        stream = BytesIO(b"x" * size)
        upload = UploadFile(stream, filename="image.png")
        seen = []

        def sniff(data, declared):
            seen.append((len(data), declared))
            return data

        helpers.service.sniff_image = sniff
        try:
            result = asyncio.run(implementation.read_image(upload))
            assert len(result) == min(size, 10485761)
            assert seen == [(min(size, 10485761), None)]
            assert stream.tell() == min(size, 10485761)
            assert len(stream.read()) == max(0, size - 10485761)
        finally:
            stream.close()


@pytest.mark.parametrize("stage", ["read", "sniff"])
@pytest.mark.parametrize("error", [
    OSError("test-only stream error"),
    ValidationError("Image is too large", code=ErrorCode.SUPPORT_IMAGE_TOO_LARGE, max_mb=10),
    ValidationError("Only PNG, JPEG and WebP images", code=ErrorCode.SUPPORT_IMAGE_INVALID),
])
def test_support_read_image_propagates_original_error(helpers, stage, error):
    snapshots = []
    for implementation in (helpers.frozen, helpers.support):
        events = []

        def sniff(data, declared):
            events.append(("sniff", data, declared))
            raise error

        helpers.service.sniff_image = sniff
        upload = RecordingUpload("a.png", b"x", events, failure=error if stage == "read" else None)
        with pytest.raises(type(error)) as caught:
            asyncio.run(implementation.read_image(upload))
        assert caught.value is error
        snapshots.append(events)
    assert snapshots[0] == snapshots[1]
    assert snapshots[1] == ([("read", 10485761)] if stage == "read" else [
        ("read", 10485761), ("content_type",), ("sniff", b"x", "image/png")
    ])


@pytest.mark.parametrize("body", ["", " \t\r\n", "\u2003hello\u2003", "x" * 4000, "x" * 4001])
@pytest.mark.parametrize("image", [None, False, object()])
def test_support_clean_body_exact_empty_errors_and_no_new_length_limit(helpers, body, image):
    results = []
    for implementation in (helpers.frozen, helpers.support):
        try:
            results.append(("return", implementation.clean_body(body, image)))
        except ValidationError as error:
            results.append((type(error), error.message, error.code, error.status, error.extra))
    assert results[0] == results[1]
    if not body.strip() and not image:
        assert results[1] == (
            ValidationError, "Write a message or attach an image", ErrorCode.SUPPORT_EMPTY_MESSAGE, 422, {}
        )
    else:
        assert results[1] == ("return", body.strip())


@pytest.mark.parametrize("body", [None, 0])
def test_support_clean_body_does_not_coerce_null_or_non_string_inputs(helpers, body):
    errors = []
    for implementation in (helpers.frozen, helpers.support):
        with pytest.raises(AttributeError) as caught:
            implementation.clean_body(body, None)
        errors.append((type(caught.value), caught.value.args))
    assert errors[0] == errors[1]


def test_support_upload_cancellation_is_not_swallowed(helpers):
    for implementation in (helpers.frozen, helpers.support):
        events = []
        failure = asyncio.CancelledError("test-only cancelled read")
        helpers.service.sniff_image = lambda *args: pytest.fail("sniff after cancellation")
        upload = RecordingUpload("image.png", b"x", events, failure=failure)
        with pytest.raises(asyncio.CancelledError) as caught:
            asyncio.run(implementation.read_image(upload))
        assert caught.value is failure
        assert events == [("read", 10485761)]


def functions_in(path):
    return {
        node.name: node for node in ast.parse(path.read_text(encoding="utf-8")).body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def test_extracted_helper_bodies_are_frozen_source_not_reimplementations():
    frozen = functions_in(FROZEN)
    for relative, names in (
        ("API/http/auth_cookies.py", ("_set_rt_cookie", "clear_rt_cookie")),
        ("API/http/support_inputs.py", ("read_image", "clean_body")),
    ):
        extracted = functions_in(WEB / relative)
        for name in names:
            assert ast.dump(extracted[name], include_attributes=False) == ast.dump(frozen[name], include_attributes=False)


def test_all_cross_router_callers_import_transport_helpers_without_wrappers():
    for relative, module, names in (
        ("API/views/auth/views.py", "API.http.auth_cookies", {"_RT_COOKIE", "_set_rt_cookie", "clear_rt_cookie"}),
        ("API/views/user/views.py", "API.http.auth_cookies", {"clear_rt_cookie"}),
        ("API/views/support/views.py", "API.http.support_inputs", {"read_image", "clean_body"}),
        ("API/views/support/internal.py", "API.http.support_inputs", {"read_image", "clean_body"}),
    ):
        tree = ast.parse((WEB / relative).read_text(encoding="utf-8"))
        imports = {alias.name for node in tree.body if isinstance(node, ast.ImportFrom) and node.module == module for alias in node.names}
        assert names <= imports
        assert not names.intersection(functions_in(WEB / relative))
