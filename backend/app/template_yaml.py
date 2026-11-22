from io import StringIO
import re

from ruamel.yaml import YAML, YAMLError
from ruamel.yaml.composer import Composer
from ruamel.yaml.events import AliasEvent

from .contract import ApiError, to_internal, to_word_graph


FORMAT = "cyber-garden/workflow-template-v1"
MAX_TEMPLATE_BYTES = 128 * 1024
YAML_MEDIA_TYPES = {"application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"}


class TemplateComposer(Composer):
    def compose_node(self, parent, index):
        if self.parser.check_event(AliasEvent):
            raise YAMLError("Aliases are not supported in workflow templates")
        return super().compose_node(parent, index)


def portable_graph(graph):
    document = to_word_graph(graph)
    for node in document["nodes"]:
        if node["type"] == "telegram":
            node["settings"].pop("channelId", None)
    return to_internal(document)


def export_template(row):
    document = {"format": FORMAT, "name": row["name"], "description": row.get("description", ""),
                **to_word_graph(portable_graph(row["graph"]))}
    yaml = YAML(typ="safe", pure=True)
    yaml.default_flow_style = False
    yaml.sort_base_mapping_type_on_output = False
    output = StringIO()
    yaml.dump(document, output)
    return output.getvalue().encode("utf-8")


def import_template(body):
    yaml = YAML(typ="safe", pure=True)
    yaml.Composer = TemplateComposer
    yaml.max_depth = 24
    try:
        document = yaml.load(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, YAMLError, RecursionError) as error:
        raise ApiError(422, "INVALID_TEMPLATE_YAML",
                       "Не удалось прочитать YAML. Проверьте синтаксис и повторяющиеся поля.") from error
    if (not isinstance(document, dict) or document.get("format") != FORMAT
            or not {"name", "nodes", "edges"} <= document.keys()
            or document.keys() - {"format", "name", "description", "nodes", "edges"}):
        raise ApiError(422, "INVALID_TEMPLATE_YAML", "Выберите YAML-шаблон сценария Cyber Garden.")
    name, description = document["name"], document.get("description", "")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 100 or not isinstance(description, str) or len(description) > 500:
        raise ApiError(422, "INVALID_TEMPLATE_YAML", "Проверьте название и описание шаблона.")
    try:
        graph = portable_graph(to_internal(document))
    except (TypeError, ValueError, KeyError, re.error) as error:
        raise ApiError(422, "INVALID_TEMPLATE_GRAPH", f"Некорректный граф шаблона. {error}") from error
    return {"name": name.strip(), "graph": graph}
