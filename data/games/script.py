import json
import sys

def main():
    if len(sys.argv) < 2:
        print("Использование: python script.py <path_to_json>")
        sys.exit(1)

    path = sys.argv[1]

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for app_id, game in data.items():
        if game.get("source") == "steam" and not game.get("isArchived", False):
            print(f"#{game['name']}")
            print(game['appId'])

if __name__ == "__main__":
    main()
