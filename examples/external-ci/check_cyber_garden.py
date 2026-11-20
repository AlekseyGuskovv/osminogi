"""Send two commits from a local Git repository to the local Cyber Garden API."""

import argparse
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from uuid import uuid4


MAX_ARCHIVE_SIZE = 20 * 1024 * 1024
ID = re.compile(r"[A-Za-z0-9_-]+")


def api(port, method, path, *, expected=200, body=None, content_type="application/json", timeout=15):
    connection = HTTPConnection("127.0.0.1", port, timeout=timeout)
    headers = {"Content-Type": content_type} if body is not None else {}
    try:
        connection.request(method, "/api/v1" + path, body, headers)
        response = connection.getresponse()
        if response.status != expected:
            raise ValueError(f"{method} {path}: HTTP {response.status} {response.reason}")
        return json.loads(response.read())
    finally:
        connection.close()


def object_id(value, label):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError(f"Invalid or missing {label}.")
    return value


def git_archive(git, repo, ref, project_dir, destination):
    try:
        result = subprocess.run([git, "-C", repo, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"],
                                check=True, capture_output=True, text=True, timeout=30)
    except subprocess.CalledProcessError as error:
        raise ValueError(f"Git commit {ref!r} is not available in {repo}.") from error
    commit = result.stdout.strip()
    tree = commit if project_dir == "." else f"{commit}:{project_dir}"
    try:
        subprocess.run([git, "-C", repo, "archive", "--format=zip", f"--output={destination}", tree],
                       check=True, capture_output=True, timeout=60)
    except subprocess.CalledProcessError as error:
        raise ValueError(f"Could not archive {tree}. Check that the project directory exists in both commits.") from error
    if destination.stat().st_size > MAX_ARCHIVE_SIZE:
        raise ValueError(f"ZIP for {commit} exceeds the 20 MiB import limit.")
    return commit


def upload(port, archive, filename):
    boundary = uuid4().hex
    begin = (f"--{boundary}\r\n"
             f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
             "Content-Type: application/zip\r\n\r\n").encode("ascii")
    end = f"\r\n--{boundary}--\r\n".encode("ascii")
    response = api(port, "POST", "/snapshots/import", expected=201, body=begin + archive.read_bytes() + end,
                   content_type=f"multipart/form-data; boundary={boundary}")
    return object_id(response["id"], "snapshot ID")


def wait_for_run(port, run_id, seconds):
    deadline = monotonic() + seconds
    while (remaining := deadline - monotonic()) > 0:
        run = api(port, "GET", f"/runs/{run_id}", timeout=min(15, remaining))
        if run["status"] not in {"queued", "running"}:
            return run
        sleep(min(1, max(0, deadline - monotonic())))
    raise TimeoutError(f"Run {run_id} did not finish within {seconds} seconds.")


def publish_summary(run, run_id, base, head):
    status = run["ci"]["status"]
    if status not in {"passed", "failed", "error"}:
        raise ValueError(f"Run {run_id} returned no final CI verdict.")
    comparison = run.get("comparison")
    if comparison is None and status != "error":
        raise ValueError(f"Run {run_id} returned no comparison.")
    lines = [
        "### Cyber Garden",
        f"- CI: **{status}**",
        f"- Run: `{run_id}`",
        f"- Base: `{base}`",
        f"- Head: `{head}`",
    ]
    if comparison is not None:
        lines.extend(f"- {kind.capitalize()}: {len(comparison[kind])}"
                     for kind in ("introduced", "existing", "resolved"))
    summary = "\n".join(lines) + "\n"
    print(summary, end="")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as output:
            output.write(summary)
    return {"passed": 0, "failed": 1, "error": 2}[status]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="Path to the checked-out repository")
    parser.add_argument("--git", default="git", help="Git executable for local use")
    parser.add_argument("--base", required=True, help="Base commit SHA or Git ref")
    parser.add_argument("--head", default="HEAD", help="Current commit SHA or Git ref")
    parser.add_argument("--project-dir", default=".", help="Project directory inside both commits")
    parser.add_argument("--workflow-id", required=True, help="ID of a saved Cyber Garden workflow")
    parser.add_argument("--port", type=int, default=8000, help="Local API port")
    parser.add_argument("--timeout", type=int, default=180, help="Seconds to wait for the result")
    args = parser.parse_args()

    try:
        workflow_id = object_id(args.workflow_id, "workflow ID")
        project_dir = PurePosixPath(args.project_dir)
        if project_dir.is_absolute() or ".." in project_dir.parts or "\\" in args.project_dir:
            raise ValueError("--project-dir must be a relative Git directory using forward slashes.")
        if not 1 <= args.port <= 65535 or args.timeout <= 0:
            raise ValueError("Use a valid local port and a positive timeout.")
        # Check the workflow before uploading either snapshot.
        api(args.port, "GET", f"/workflows/{workflow_id}")
        with TemporaryDirectory(prefix="cyber-garden-") as temp:
            base_zip, head_zip = Path(temp) / "base.zip", Path(temp) / "head.zip"
            base = git_archive(args.git, args.repo, args.base, project_dir.as_posix(), base_zip)
            head = git_archive(args.git, args.repo, args.head, project_dir.as_posix(), head_zip)
            base_id = upload(args.port, base_zip, f"base-{base}.zip")
            head_id = upload(args.port, head_zip, f"head-{head}.zip")
        body = json.dumps({"trigger": "ci", "baseSnapshotId": base_id, "snapshotId": head_id}).encode()
        accepted = api(args.port, "POST", f"/workflows/{workflow_id}/runs", expected=202, body=body)
        run_id = object_id(accepted["id"], "run ID")
        run = wait_for_run(args.port, run_id, args.timeout)
        return publish_summary(run, run_id, base, head)
    except (OSError, HTTPException, subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as error:
        print(f"Cyber Garden error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
