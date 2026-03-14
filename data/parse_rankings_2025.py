import json

points_to_place = {
    10000: 1,
    7800: 2,
    6085: 3,
    4745: 5,
    3320: 9,
    1330: 13,
    265: 33
}

surfers = []
events = [
    {"number": 1, "name": "Lexus Pipe Pro"},
    {"number": 2, "name": "Surf Abu Dhabi Pro"},
    {"number": 3, "name": "MEO Rip Curl Pro Portugal"},
    {"number": 4, "name": "Surf City El Salvador Pro"},
    {"number": 5, "name": "Rip Curl Pro Bells Beach"},
    {"number": 6, "name": "Bonsoy Gold Coast Pro"},
    {"number": 7, "name": "Western Australia Margaret River Pro"},
    {"number": 8, "name": "Lexus Trestles Pro"},
    {"number": 9, "name": "VIVO Rio Pro"},
    {"number": 10, "name": "Corona Open J-Bay"},
    {"number": 11, "name": "Tahiti Pro"},
]

with open('/Users/msierks/surfing/gladtobebrad.github.io/rankings_2025.txt', 'r') as f:
    for line in f:
        if line.startswith('|'):
            parts = [p.strip() for p in line.split('|')[1:-1]]
            if len(parts) >= 17:
                rank = int(parts[0])
                name_parts = parts[3].split()
                first_word = name_parts[0]
                # The name is duplicated: "First Last First Last Country..."
                # Find where the second copy starts
                repeat_idx = name_parts.index(first_word, 1)
                name = ' '.join(name_parts[repeat_idx:repeat_idx * 2])
                points = parts[5:16]  # 11 points
                finishes = []
                for p in points:
                    p_clean = p.replace(',', '').replace('*', '').strip()
                    if p_clean == '-' or p_clean == '':
                        finishes.append(None)
                    else:
                        p_int = int(p_clean)
                        finishes.append(points_to_place.get(p_int, None))
                surfers.append({
                    "name": name,
                    "places": finishes
                })

output = {
    "year": 2025,
    "tour": "mens",
    "events": [e["name"] for e in events],
    "surfers": surfers
}

print(json.dumps(output, indent=2))