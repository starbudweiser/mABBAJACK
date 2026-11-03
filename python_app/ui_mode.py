"""Présentation de l'interface (Simple ou Expert) : choix mémorisé dans ui_mode.json, à côté de language.json.
Le fichier est la référence : l'interface web le reçoit par ?mode= au lancement, le menu « Affichage » et les
Paramètres le modifient (les Paramètres préviennent l'appli par window.expose)."""
import json
from pathlib import Path

MODES = ("simple", "expert")
DEFAULT = "simple"  # premier lancement


def normalize(mode) -> str:
    return mode if mode in MODES else DEFAULT


class ModeStore:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "ui_mode.json"

    def get(self) -> str:
        try:
            return normalize(json.loads(self.path.read_text(encoding="utf-8")).get("mode"))
        except (OSError, ValueError, AttributeError):
            return DEFAULT

    def has_choice(self) -> bool:
        """Vrai une fois que l'utilisateur a choisi un mode (sinon l'interface décide, Simple par défaut)."""
        return self.path.exists()

    def set(self, mode: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"mode": normalize(mode)}), encoding="utf-8")
