#!/bin/bash
# ==============================================================================
#  mWabbajack • macOS Skyrim Modlist Installer Launcher
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/../web"

echo -e "\033[1;36m====================================================\033[0m"
echo -e "\033[1;36m         ⚡ mWabbajack • macOS Edition ⚡          \033[0m"
echo -e "\033[1;36m     Portage Modlist Installer pour Skyrim SE/AE    \033[0m"
echo -e "\033[1;36m====================================================\033[0m"

# Vérification de Node.js
if ! command -v node >/dev/null 2>&1; then
    echo -e "\033[1;31m[ERREUR] Node.js n'est pas détecté dans votre PATH.\033[0m"
    echo -e "Veuillez installer Node.js via brew ou depuis https://nodejs.org"
    read -p "Appuyez sur Entrée pour quitter..."
    exit 1
fi

echo -e "\033[0;32m[✓] Node.js $(node -v) détecté.\033[0m"

# Installation des dépendances si nécessaire
if [ ! -d "node_modules" ]; then
    echo -e "\033[1;33m[*] Première exécution : installation des dépendances npm...\033[0m"
    npm install
fi

# Build de l'interface React
echo -e "\033[1;33m[*] Compilation de l'interface...\033[0m"
npm run build

# Lancement du serveur unifié mWabbajack (API + Interface)
echo -e "\033[1;32m[*] Démarrage du serveur mWabbajack sur http://localhost:3000...\033[0m"
node server/server.js &
SERVER_PID=$!

# Attente brève et ouverture du navigateur
sleep 1.5
open "http://localhost:3000"

echo -e "\033[1;34m====================================================\033[0m"
echo -e "\033[1;32m✓ mWabbajack est actif sur http://localhost:3000 !\033[0m"
echo -e "\033[0;37mPour arrêter l'application, appuyez sur [Ctrl + C] dans cette fenêtre.\033[0m"
echo -e "\033[1;34m====================================================\033[0m"

# Gestion de l'arrêt propre
cleanup() {
    echo -e "\n\033[1;33mArrêt des services mWabbajack...\033[0m"
    kill $SERVER_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM
wait
