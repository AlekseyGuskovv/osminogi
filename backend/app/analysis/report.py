def submission_row(item):
    category = item.get("category") or item["ruleId"].split("-", 1)[0]
    result = {"category": category, "path": item["path"], "severity": item["severity"].upper(),
              "description": item["title"]}
    if item.get("remediation"):
        result["remediation"] = item["remediation"]
    if category == "SCA":
        if all(item.get(key) for key in ("group", "artifact", "version")):
            result.update({key: item[key] for key in ("group", "artifact", "version", "advisoryId")})
        else:
            # Older stored SCA rows carry the coordinate as their evidence.
            group, artifact, version = item["evidence"].split(":", 2)
            result.update(group=group, artifact=artifact, version=version, advisoryId=item["advisoryId"])
    else:
        result.update({"class": item.get("classification") or item["ruleId"], "line": item["line"]})
        if item.get("endLine") is not None and item["endLine"] > item["line"]:
            result["endLine"] = item["endLine"]
    return result


def submission(findings):
    return {"findings": [submission_row(item) for item in findings]}


def markdown(report):
    header = ["# Cyber Garden — отчёт проверки", ""]
    if not report["findings"]:
        return "\n".join([*header, "Находок нет.", ""])
    rows = ["| Категория | Критичность | Проблема | Где | Исправление |",
            "|---|---|---|---|---|"]

    def cell(text):
        return str(text).replace("|", r"\|").replace("\r", " ").replace("\n", " ").replace("<", "&lt;")

    for item in report["findings"]:
        location = item["path"]
        if item["category"] == "SCA":
            location += " · " + ":".join(item[key] for key in ("group", "artifact", "version"))
            location += " · " + item["advisoryId"]
        else:
            location += ":" + str(item["line"])
            if "endLine" in item:
                location += "–" + str(item["endLine"])
        rows.append("| " + " | ".join(map(cell, (item["category"], item["severity"],
                    item["description"], location, item.get("remediation", "—")))) + " |")
    return "\n".join([*header, *rows, ""])


def matches(found, expected):
    if found["category"] != expected["category"]:
        return False
    locations = [expected, *expected.get("alternateLocations", [])]
    for location in locations:
        if found["path"].replace("\\", "/") != location.get("path", expected["path"]).replace("\\", "/"):
            continue
        if found["category"] == "SCA":
            if all(found.get(key) == expected.get(key) for key in ("group", "artifact", "version")):
                ids = expected.get("advisoryIds") or [expected.get("advisoryId")]
                if found.get("advisoryId") in ids:
                    return True
        elif (found["class"] in {expected["class"], *expected.get("classAliases", [])}
              and location.get("line", expected["line"]) <= found["line"]
              <= location.get("endLine", location.get("line", expected.get("endLine", expected["line"])))):
            return True
    return False


def score_submission(report, truth):
    result = {}
    for category in ("SECRET", "SCA", "SAST"):
        expected = [row for row in truth["findings"] if row["category"] == category]
        actual = [row for row in report["findings"] if row["category"] == category]
        controls = [row for row in truth.get("controls", []) if row["category"] == category]
        unmatched = expected.copy()
        positive = 0
        for row in actual:
            matched = next((entry for entry in unmatched if matches(row, entry)), None)
            if matched is not None:
                unmatched.remove(matched)
                positive += 1
        result[category] = {"matched": positive, "missed": len(unmatched),
                            "falsePositives": len(actual) - positive,
                            "controlsFlagged": sum(any(matches(row, control) for row in actual) for control in controls),
                            "missedIds": [row["id"] for row in unmatched]}
    return result