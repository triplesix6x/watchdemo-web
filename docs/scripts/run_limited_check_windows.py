"""Run one Windows check with a job-wide memory limit and one-CPU affinity.

Usage: python docs/scripts/run_limited_check_windows.py --timeout 180 -- command args
No command starts if containment or the free-memory check fails.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes as w
import os
from pathlib import Path
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--memory-mib", type=int, default=1024)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if os.name != "nt":
        parser.error("Windows Job Objects are required; no unrestricted fallback")
    if not command or args.memory_mib <= 0 or args.timeout <= 0:
        parser.error("provide a command and positive resource limits")
    if Path(command[0]).stem.lower() in {"docker", "podman", "wsl"}:
        parser.error("external/container workloads do not inherit these limits")

    k = ctypes.WinDLL("kernel32", use_last_error=True)
    size_t = ctypes.c_size_t

    class MemoryStatus(ctypes.Structure):
        _fields_ = [("length", w.DWORD), ("load", w.DWORD)] + [
            (name, ctypes.c_ulonglong) for name in (
                "total_physical", "available_physical", "total_page", "available_page",
                "total_virtual", "available_virtual", "available_extended",
            )
        ]

    class BasicLimit(ctypes.Structure):
        _fields_ = [
            ("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
            ("flags", w.DWORD), ("minimum_working_set", size_t),
            ("maximum_working_set", size_t), ("active_process_limit", w.DWORD),
            ("affinity", size_t), ("priority_class", w.DWORD), ("scheduling_class", w.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes",
        )]

    class ExtendedLimit(ctypes.Structure):
        _fields_ = [
            ("basic", BasicLimit), ("io", IoCounters), ("process_memory", size_t),
            ("job_memory", size_t), ("peak_process_memory", size_t), ("peak_job_memory", size_t),
        ]

    class StartupInfo(ctypes.Structure):
        _fields_ = [
            ("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR),
            ("title", w.LPWSTR), ("x", w.DWORD), ("y", w.DWORD),
            ("x_size", w.DWORD), ("y_size", w.DWORD), ("x_chars", w.DWORD),
            ("y_chars", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD),
            ("show", w.WORD), ("reserved_size", w.WORD), ("reserved_bytes", ctypes.POINTER(w.BYTE)),
            ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE),
        ]

    class ProcessInfo(ctypes.Structure):
        _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE),
                    ("process_id", w.DWORD), ("thread_id", w.DWORD)]

    signatures = {
        "CreateMutexW": ([ctypes.c_void_p, w.BOOL, w.LPCWSTR], w.HANDLE),
        "ReleaseMutex": ([w.HANDLE], w.BOOL),
        "GlobalMemoryStatusEx": ([ctypes.POINTER(MemoryStatus)], w.BOOL),
        "CreateJobObjectW": ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
        "SetInformationJobObject": ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
        "GetCurrentProcess": ([], w.HANDLE),
        "GetProcessAffinityMask": ([w.HANDLE, ctypes.POINTER(size_t), ctypes.POINTER(size_t)], w.BOOL),
        "GetStdHandle": ([w.DWORD], w.HANDLE),
        "CreateProcessW": ([w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL,
                            w.DWORD, ctypes.c_void_p, w.LPCWSTR,
                            ctypes.POINTER(StartupInfo), ctypes.POINTER(ProcessInfo)], w.BOOL),
        "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
        "ResumeThread": ([w.HANDLE], w.DWORD),
        "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
        "GetExitCodeProcess": ([w.HANDLE, ctypes.POINTER(w.DWORD)], w.BOOL),
        "TerminateProcess": ([w.HANDLE, w.UINT], w.BOOL),
        "CloseHandle": ([w.HANDLE], w.BOOL),
    }
    for name, (argtypes, restype) in signatures.items():
        function = getattr(k, name)
        function.argtypes = argtypes
        function.restype = restype

    def require(result: object, action: str) -> None:
        if not result:
            raise OSError(ctypes.get_last_error(), action)

    mutex = k.CreateMutexW(None, True, "Local\\WatchDemoLimitedLocalCheck")
    require(mutex, "CreateMutexW")
    if ctypes.get_last_error() == 183:
        k.CloseHandle(mutex)
        print("Another limited check is running; nothing started.", file=sys.stderr)
        return 2
    job = None
    process = ProcessInfo()
    try:
        memory = MemoryStatus()
        memory.length = ctypes.sizeof(memory)
        require(k.GlobalMemoryStatusEx(ctypes.byref(memory)), "GlobalMemoryStatusEx")
        if memory.available_physical < 4 * 1024**3:
            raise RuntimeError("Less than 4 GiB available RAM; nothing started")
        available, system = size_t(), size_t()
        require(k.GetProcessAffinityMask(k.GetCurrentProcess(), ctypes.byref(available),
                                         ctypes.byref(system)), "GetProcessAffinityMask")
        if not available.value:
            raise RuntimeError("No available CPU affinity; nothing started")
        job = k.CreateJobObjectW(None, None)
        require(job, "CreateJobObjectW")
        limits = ExtendedLimit()
        # AFFINITY | JOB_MEMORY | KILL_ON_JOB_CLOSE. Descendants cannot break away.
        limits.basic.flags = 0x10 | 0x200 | 0x2000
        limits.basic.affinity = available.value & -available.value
        limits.job_memory = args.memory_mib * 1024**2
        require(k.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)),
                "SetInformationJobObject")
        startup = StartupInfo()
        startup.cb = ctypes.sizeof(startup)
        startup.flags = 0x100  # STARTF_USESTDHANDLES
        startup.stdin = k.GetStdHandle(w.DWORD(-10).value)
        startup.stdout = k.GetStdHandle(w.DWORD(-11).value)
        startup.stderr = k.GetStdHandle(w.DWORD(-12).value)
        line = ctypes.create_unicode_buffer(subprocess.list2cmdline(command))
        # Suspended creation ensures command code cannot run before job assignment.
        require(k.CreateProcessW(None, line, None, None, True, 0x4, None, None,
                                 ctypes.byref(startup), ctypes.byref(process)), "CreateProcessW")
        if not k.AssignProcessToJobObject(job, process.process):
            error = ctypes.get_last_error()
            k.TerminateProcess(process.process, 2)
            raise OSError(error, "AssignProcessToJobObject; suspended command terminated")
        if k.ResumeThread(process.thread) == 0xFFFFFFFF:
            raise OSError(ctypes.get_last_error(), "ResumeThread")
        print(f"Contained check: {args.memory_mib} MiB job memory, one logical CPU, "
              f"{args.timeout}s timeout", flush=True)
        outcome = k.WaitForSingleObject(process.process, min(args.timeout * 1000, 0xFFFFFFFE))
        if outcome == 0x102:
            print("Check timed out; terminating the job and its descendants.", file=sys.stderr)
            return 124  # finally closes the job, killing all descendants.
        if outcome != 0:
            raise OSError(ctypes.get_last_error(), "WaitForSingleObject")
        code = w.DWORD()
        require(k.GetExitCodeProcess(process.process, ctypes.byref(code)), "GetExitCodeProcess")
        return code.value if code.value < 0x80000000 else 1
    finally:
        if job:
            k.CloseHandle(job)
        if process.thread:
            k.CloseHandle(process.thread)
        if process.process:
            k.CloseHandle(process.process)
        k.ReleaseMutex(mutex)
        k.CloseHandle(mutex)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as exc:
        print(f"Contained check refused/failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
