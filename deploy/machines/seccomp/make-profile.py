#!/usr/bin/env python3
"""Generate seccomp/chrome.json from Docker's default seccomp profile.

Chrome's sandbox needs to create user, PID and network namespaces. Docker's
default profile only allows clone/unshare/setns with namespace flags to
containers holding CAP_SYS_ADMIN, so Chrome dies with "Failed to move to new
namespace". Instead of running machines with seccomp=unconfined (no syscall
filter at all) this keeps Docker's default profile and only lifts that one
restriction: clone, unshare and setns are allowed unconditionally. clone3
keeps returning ENOSYS, so libc falls back to clone.

Usage: make-profile.py DEFAULT_JSON > chrome.json
  DEFAULT_JSON: https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json
"""
import json
import sys

profile = json.load(open(sys.argv[1]))
NS = {"clone", "setns", "unshare"}
rules = [r for r in profile["syscalls"]
         if not (r.get("action") == "SCMP_ACT_ALLOW" and NS & set(r["names"]))]
rules.append({
    "names": sorted(NS),
    "action": "SCMP_ACT_ALLOW",
    "comment": "Chrome sandbox: user/PID/network namespaces",
})
profile["syscalls"] = rules
json.dump(profile, sys.stdout, indent=1)
sys.stdout.write("\n")
