"""Build web/data.js from D2R's data tables.

Source: JSON exports of the game's .txt tables from https://github.com/blizzhackers/d2data
(json/ folder). Download these files into one directory:
  uniqueitems setitems sets runes armor weapons misc itemtypes properties skilldesc
  itemstatcost skills runeworduicategories localestrings-eng allstrings-eng

Usage:  python3 -I tools/build_data.py <d2data-json-dir> web/data.js
"""
import json
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]


def load(name):
    with open(os.path.join(SRC, name + ".json"), encoding="utf-8") as f:
        data = json.load(f)
    return list(data.values()) if isinstance(data, dict) else data


STR = dict(json.load(open(os.path.join(SRC, "localestrings-eng.json"), encoding="utf-8")))
# localestrings lacks names added in later patches (e.g. Runeword171 "Hysteria", the old
# "Hustle (armor)"); fill those gaps from the full string table without overriding anything.
for key, value in json.load(open(os.path.join(SRC, "allstrings-eng.json"), encoding="utf-8")).items():
    STR.setdefault(key, value)
BASES = {b["code"]: b | {"_kind": kind}
         for kind in ("armor", "weapons", "misc") for b in load(kind) if b.get("code")}
TYPES = {t["Code"]: t for t in load("itemtypes") if t.get("Code")}
PROPS = {p["code"]: p for p in load("properties") if p.get("code")}
STATS = {s["Stat"]: s for s in load("itemstatcost") if s.get("Stat")}
SKILLS = {}
for s in load("skills"):
    if s.get("skill") is not None:
        SKILLS[str(s["*Id"])] = s
        SKILLS[s["skill"].lower()] = s

SKILLDESC = {d["skilldesc"]: d for d in load("skilldesc") if d.get("skilldesc")}

CLASS_NAMES = {"ama": "Amazon", "sor": "Sorceress", "nec": "Necromancer", "pal": "Paladin",
               "bar": "Barbarian", "dru": "Druid", "ass": "Assassin", "war": "Warlock"}
# Item skill-tab ids 0-23, in charstats.txt StrSkillTab1-3 order per class.
SKILL_TABS = ["Bow and Crossbow", "Passive and Magic", "Javelin and Spear",
              "Fire", "Lightning", "Cold",
              "Curses", "Poison and Bone", "Summoning",
              "Combat", "Offensive Auras", "Defensive Auras",
              "Combat", "Masteries", "Warcries",
              "Summoning", "Shape Shifting", "Elemental",
              "Traps", "Shadow Disciplines", "Martial Arts",
              "Demon", "Eldritch", "Chaos"]
TAB_CLASS = ["Amazon"] * 3 + ["Sorceress"] * 3 + ["Necromancer"] * 3 + ["Paladin"] * 3 + \
            ["Barbarian"] * 3 + ["Druid"] * 3 + ["Assassin"] * 3 + ["Warlock"] * 3

# Templates in properties.txt that are wrong or missing.
TEMPLATE_FIX = {
    "pierce-mag": "-#% to Enemy Magic Resistance",
    "dmg-mag/lvl": "+# to Maximum Magic Damage (Based on Character Level)",
    "randclassskill": "+3 to Random Character Class Skills",
    "bar": "+# to Barbarian Skill Levels",
    "dmg%": "+#% Enhanced Damage",
    "dmg-min": "+# to Minimum Damage",
    "dmg-max": "+# to Maximum Damage",
    "reanimate": "Reanimate As: Returned",
}
# Min/max property pairs the game shows as one "Adds X-Y" line.
DAMAGE_PAIRS = {("fire-min", "fire-max"): "Fire", ("ltng-min", "ltng-max"): "Lightning",
                ("cold-min", "cold-max"): "Cold", ("dmg-min", "dmg-max"): ""}
SKIP_PROPS = {"state", "dur", "levelreq", "color"}

# Chronicle UI categories (itemuicategories.txt), in game order, with English labels.
UI_TREE = [
    ("armo", "Armor", [("helms", "Helms"), ("circl", "Circlets"), ("armor", "Body Armor"),
                       ("shlds", "Shields"), ("glove", "Gloves"), ("boots", "Boots"),
                       ("belts", "Belts"), ("barbh", "Barbarian Helms"), ("druid", "Druid Pelts"),
                       ("palad", "Paladin Shields"), ("necro", "Shrunken Heads"),
                       ("warlo", "Grimoires")]),
    ("weap", "Weapons", [("axes", "Axes"), ("bows", "Bows"), ("xbows", "Crossbows"),
                         ("daggs", "Daggers"), ("javel", "Javelins"), ("maces", "Maces"),
                         ("poles", "Polearms"), ("scept", "Scepters"), ("spear", "Spears"),
                         ("stave", "Staves"), ("sword", "Swords"), ("throw", "Throwing Weapons"),
                         ("wands", "Wands"), ("amazo", "Amazon Weapons"),
                         ("assas", "Claws"), ("sorce", "Orbs")]),
    ("acce", "Accessories", [("charm", "Charms"), ("amule", "Amulets"),
                             ("rings", "Rings"), ("jewel", "Jewels")]),
]
# Silhouette per UI category (symbols defined in index.html).
ICONS = {"helms": "helm", "circl": "circlet", "armor": "armor", "shlds": "shield", "glove": "gloves",
         "boots": "boots", "belts": "belt", "barbh": "helm", "druid": "pelt", "palad": "shield",
         "necro": "head", "warlo": "book", "axes": "axe", "bows": "bow", "xbows": "xbow",
         "daggs": "dagger", "javel": "javelin", "maces": "mace", "poles": "polearm",
         "scept": "scepter", "spear": "javelin", "stave": "staff", "sword": "sword",
         "throw": "dagger", "wands": "wand", "amazo": "bow", "assas": "claw", "sorce": "orb",
         "charm": "charm", "amule": "amulet", "rings": "ring", "jewel": "jewel"}
RW_ICONS = {"r_arm": "armor", "r_hel": "helm", "r_off": "shield", "r_mel": "sword", "r_mis": "bow"}


def s(key, fallback=None):
    v = STR.get(key)
    return v if v else (fallback if fallback is not None else key)


def ui_category(type_code, depth=0):
    t = TYPES.get(type_code)
    if not t or depth > 6:
        return None
    return t.get("UICategory") or ui_category(t.get("Equiv1"), depth + 1)


def tier_of(base):
    code = base["code"]
    if base["_kind"] == "misc":
        return "normal"
    if code == base.get("ultracode"):
        return "elite"
    if code == base.get("ubercode"):
        return "exceptional"
    return "normal"


def base_stats(base):
    out = []
    if base["_kind"] == "armor":
        if base.get("maxac"):
            out.append(f"Base Defense: {rng(base.get('minac', 0), base['maxac'])}")
        if base.get("block"):
            out.append(f"Base Chance to Block: {base['block']}%")
    elif base["_kind"] == "weapons":
        if base.get("2handmaxdam") and base.get("2handed"):
            out.append(f"Base Two-Hand Damage: {base.get('2handmindam', 0)} to {base['2handmaxdam']}")
        if base.get("maxdam"):
            out.append(f"Base One-Hand Damage: {base.get('mindam', 0)} to {base['maxdam']}")
        if base.get("maxmisdam"):
            out.append(f"Base Throw Damage: {base.get('minmisdam', 0)} to {base['maxmisdam']}")
    if base.get("reqstr"):
        out.append(f"Required Strength: {base['reqstr']}")
    if base.get("reqdex"):
        out.append(f"Required Dexterity: {base['reqdex']}")
    return out


def rng(a, b):
    if a is None:
        a = b
    if b is None:
        b = a
    return f"{a}" if a == b else f"{a}-{b}"


def skill_name(par):
    sk = SKILLS.get(str(par).lower()) if par is not None else None
    if not sk:
        return str(par)
    desc = SKILLDESC.get(sk.get("skilldesc"), {})
    return s(desc.get("str name"), sk["skill"]) if desc.get("str name") else sk["skill"]


def skill_class(par):
    sk = SKILLS.get(str(par).lower())
    return CLASS_NAMES.get((sk or {}).get("charclass"), "")


def describe(code, par, lo, hi):
    """One property -> tooltip line (None to hide)."""
    if code in SKIP_PROPS or code not in PROPS:
        return None
    tpl = TEMPLATE_FIX.get(code) or PROPS[code].get("*Tooltip")
    if not tpl or tpl == "None":
        return None
    tpl = re.sub(r"\s+", " ", tpl)
    if "[Skill]" in tpl:
        tpl = tpl.replace("[Skill]", skill_name(par)).replace("[Class]", skill_class(par))
    if "[Class Skill Tab]" in tpl:
        try:
            i = int(par)
            tpl = tpl.replace("[Class Skill Tab]", f"{SKILL_TABS[i]}").replace(
                " Skills", f" Skills ({TAB_CLASS[i]} Only)")
        except (TypeError, ValueError, IndexError):
            tpl = tpl.replace("[Class Skill Tab]", "Class")
    if "[Monster Type]" in tpl:
        tpl = tpl.replace("[Monster Type]", str(par))

    if code in ("hit-skill", "gethit-skill", "att-skill", "kill-skill", "death-skill", "levelup-skill"):
        return tpl.replace("#", str(lo), 1).replace("#", str(hi), 1)
    if code == "charged":
        return f"Level {hi} {skill_name(par)} ({lo}/{lo} Charges)"
    if code == "aura":
        return tpl.replace("#", rng(lo, hi), 1)
    if code == "dmg-pois" and par:
        frames = int(par)
        return (f"Adds {rng(round(lo * frames / 256), round(hi * frames / 256))} Poison Damage "
                f"Over {frames / 25:g} Seconds")
    if code.endswith("/lvl"):
        # Value is par/8 (or par/2) per character level; show the level 1-99 range.
        div = 2 if "#/2" in (PROPS[code].get("*Parameter") or "") else 8
        per = int(par or 0) / div
        return tpl.replace("#", rng(int(per), int(per * 99)), 1)
    if code.endswith("/time"):
        return None
    if code == "sock":
        return tpl.replace("#", rng(lo or par, hi or lo or par))
    if code == "rep-dur":
        return f"Repairs 1 Durability in {round(100 / int(par))} Seconds" if par else None
    if tpl.count("#") >= 2:
        return tpl.replace("#", str(lo), 1).replace("#", str(hi), 1)
    if lo is not None and hi is not None and lo < 0 and hi < 0:
        tpl = tpl.replace("+#", "#")
    if "-#" in tpl and lo != hi:
        return tpl.replace("-#", f"-{lo} to -{hi}", 1)
    return tpl.replace("#", rng(lo, hi), 1)


def priority(code):
    p = PROPS.get(code, {})
    stat = STATS.get(p.get("stat1"), {})
    return stat.get("descpriority", 0)


def mods(row, prefix="prop", mn="min", mx="max", par="par", n=12):
    out = []
    entries = [(row.get(f"{prefix}{i}"), row.get(f"{par}{i}"), row.get(f"{mn}{i}"), row.get(f"{mx}{i}"))
               for i in range(1, n + 1) if row.get(f"{prefix}{i}")]
    codes = {e[0]: e for e in entries}
    merged = set()
    for (a, b), label in DAMAGE_PAIRS.items():
        if a in codes and b in codes:
            merged |= {a, b}
            dmg = f" {label}" if label else ""
            lo_txt, hi_txt = rng(codes[a][2], codes[a][3]), rng(codes[b][2], codes[b][3])
            sep = " to " if "-" in lo_txt + hi_txt else "-"
            out.append((priority(a), f"Adds {lo_txt}{sep}{hi_txt}{dmg} Damage"))
    for code, p, lo, hi in entries:
        if code in merged:
            continue
        line = describe(code, p, lo, hi)
        if line:
            out.append((priority(code), line))
    out.sort(key=lambda x: -x[0])
    seen, result = set(), []
    for _, line in out:
        if line not in seen:
            seen.add(line)
            result.append(line)
    return result


def ladder(row):
    if row.get("firstLadderSeason") or row.get("lastLadderSeason"):
        return True
    return False


# ---------------------------------------------------------------- Uniques
uniques, dup_count = [], {}
for row in load("uniqueitems"):
    if not row.get("index") or row.get("disableChronicle") or not row.get("code"):
        continue
    base = BASES.get(row["code"])
    if not base:
        continue
    cat = ui_category(base.get("type"))
    if cat not in ICONS:
        continue
    name = s(row["index"])
    dup_count[name] = dup_count.get(name, 0) + 1
    uniques.append({
        "id": f"u{row['*ID']}",
        "name": name,
        "base": s(base["code"], base.get("name")),
        "cat": cat,
        "tier": tier_of(base),
        "icon": ICONS[cat],
        "req": row.get("lvl req", 0),
        "ilvl": row.get("lvl", 0),
        "stats": base_stats(base),
        "mods": mods(row),
        **({"ladder": True} if ladder(row) else {}),
        **({"classic": True} if row.get("version") == 0 else {}),
    })
# Items sharing a name (e.g. the Rainbow Facet variants) get a variant label.
seen = {}
for u in uniques:
    if dup_count[u["name"]] > 1:
        seen[u["name"]] = seen.get(u["name"], 0) + 1
        u["variant"] = seen[u["name"]]

# ---------------------------------------------------------------- Sets
SETS = {x["index"]: x for x in load("sets") if x.get("index")}


def set_bonus(row, prefix_code, prefix_min, prefix_max, prefix_par, suffixes):
    out = []
    for i in range(1, 9):
        for sfx in suffixes:
            code = row.get(f"{prefix_code}{i}{sfx}")
            if not code:
                continue
            line = describe(code, row.get(f"{prefix_par}{i}{sfx}"), row.get(f"{prefix_min}{i}{sfx}"),
                            row.get(f"{prefix_max}{i}{sfx}"))
            if line:
                out.append((i, line))
    return out


set_items = []
for row in load("setitems"):
    if not row.get("index") or row.get("disableChronicle") or not row.get("item"):
        continue
    base = BASES.get(row["item"])
    if not base:
        continue
    cat = ui_category(base.get("type"))
    item_bonus = [f"{line} ({n + 1} Items)" for n, line in
                  set_bonus(row, "aprop", "amin", "amax", "apar", ("a", "b"))]
    set_items.append({
        "id": f"s{row['*ID']}",
        "name": s(row["index"]),
        "set": "set:" + row["set"],
        "setName": s(row["set"]),
        "base": s(base["code"], base.get("name")),
        "cat": cat,
        "tier": tier_of(base),
        "icon": ICONS.get(cat, "charm"),
        "req": row.get("lvl req", 0),
        "stats": base_stats(base),
        "mods": mods(row, n=9),
        "setMods": item_bonus,
        **({"classic": True} if not row.get("expansion") else {}),
    })

sets_out = []
for key, srow in SETS.items():
    members = [i for i in set_items if i["set"] == "set:" + key]
    if not members:
        continue
    partial = [f"{line} ({n} Items)" for n, line in set_bonus(srow, "PCode", "PMin", "PMax", "PParam", ("a", "b"))]
    full = [line for _, line in set_bonus(srow, "FCode", "FMin", "FMax", "FParam", ("",))]
    sets_out.append({"id": "set:" + key, "name": s(key), "classic": not srow.get("expansion"),
                     "partial": partial, "full": full, "size": len(members)})
sets_out.sort(key=lambda x: x["name"])

# The game lists entries alphabetically by base item name.
for lst in (uniques, set_items):
    lst.sort(key=lambda i: (i["base"], i["name"]))

# ---------------------------------------------------------------- Runewords
RUNE_NAMES = {b["code"]: s(b["code"], b.get("name")).replace(" Rune", "") for b in load("misc")
              if re.fullmatch(r"r\d\d", b.get("code", ""))}
RUNE_REQ = {b["code"]: b.get("levelreq", 0) for b in load("misc") if re.fullmatch(r"r\d\d", b.get("code", ""))}
RW_CATS = {c["Name"]: c["*Category"] for c in load("runeworduicategories")}
RW_ORDER = ["r_arm", "r_hel", "r_off", "r_mel", "r_mis"]


def rw_categories(type_code, depth=0):
    t = TYPES.get(type_code)
    if not t or depth > 6:
        return []
    cats = [t[k] for k in ("RunewordCategory1", "RunewordCategory2") if t.get(k)]
    return cats or rw_categories(t.get("Equiv1"), depth + 1)


runewords = []
for row in load("runes"):
    if not row.get("complete"):
        continue
    runes = [row[f"Rune{i}"] for i in range(1, 7) if row.get(f"Rune{i}")]
    itypes = [row[f"itype{i}"] for i in range(1, 7) if row.get(f"itype{i}")]
    cats = []
    for t in itypes:
        for c in rw_categories(t):
            if c not in cats:
                cats.append(c)
    if not cats:
        continue
    bases = ", ".join(s(TYPES[t]["ItemType"], TYPES[t]["ItemType"]) if t in TYPES else t for t in itypes)
    cat = sorted(cats, key=RW_ORDER.index)[0]
    runewords.append({
        "id": row["Name"].lower(),
        "name": s(row["Name"], row.get("*Rune Name")),
        "runes": [RUNE_NAMES.get(r, r) for r in runes],
        "base": f"{len(runes)} Socket {bases}",
        "cat": cat,
        "cats": cats,
        "tier": "normal",
        "icon": RW_ICONS[cat],
        "req": max(RUNE_REQ.get(r, 0) for r in runes),
        "mods": mods(row, prefix="T1Code", mn="T1Min", mx="T1Max", par="T1Param", n=7),
        **({"ladder": True} if "Ladder" in str(row.get("*Patch Release", "")) and "Previously" not in str(row.get("*Patch Release", "")) else {}),
    })
runewords.sort(key=lambda r: r["name"])

# ---------------------------------------------------------------- Output
data = {
    "unique": {
        "qualityFilter": True,
        "categories": [{"id": p, "name": n, "children": [{"id": c, "name": cn} for c, cn in ch]}
                       for p, n, ch in UI_TREE],
        "items": uniques,
    },
    "sets": {
        "qualityFilter": True,
        "categories": [{"id": p, "name": n, "children": [{"id": c, "name": cn} for c, cn in ch]}
                       for p, n, ch in UI_TREE],
        "sets": {x["id"]: x for x in sets_out},
        "items": set_items,
    },
    "runewords": {
        "qualityFilter": False,
        "categories": [{"id": "rw", "name": "Runewords",
                        "children": [{"id": c, "name": RW_CATS[c]} for c in RW_ORDER]}],
        "items": runewords,
    },
}
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("// Generated by tools/build_data.py from D2R data tables (blizzhackers/d2data). Do not edit by hand.\n")
    f.write("window.CHRONICLE_DATA = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print(f"uniques {len(uniques)}  set items {len(set_items)} in {len(sets_out)} sets  runewords {len(runewords)}")
