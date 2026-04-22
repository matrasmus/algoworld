"""Topic definitions and affinity matrix."""

TOPICS = [
    {"id": 0, "name": "Cats",  "color": (240, 160, 60)},
    {"id": 1, "name": "Dogs",  "color": (100, 180, 240)},
    {"id": 2, "name": "Mice",  "color": (180, 130, 210)},
    {"id": 3, "name": "Birds", "color": (80, 210, 80)},
]

NUM_TOPICS = len(TOPICS)

# Affinity matrix: AFFINITY[post_topic][node_community]
#
# Intuitions:
#   Cats love watching mice & birds (prey content)
#   Dogs hate cats, chase mice, like birds (outdoor companions)
#   Mice fear cats & dogs, ally with birds (small animal solidarity)
#   Birds fear cats, like dogs (outdoor) & mice (solidarity)
#
# Each row: self=2, mix of allies(+1) and rivals(-1)
#
#                 Cats  Dogs  Mice  Birds
AFFINITY = [
    [  2,   -1,   +1,   +1],  # Cats:  hate dogs, love watching prey (mice+birds)
    [ -1,    2,   -1,   +1],  # Dogs:  hate cats, chase mice, outdoor buddy birds
    [ -1,   -1,    2,   +1],  # Mice:  fear cats & dogs, ally birds
    [ -1,   +1,   +1,    2],  # Birds: fear cats, like dogs & mice
]

CONTROVERSIAL_TOPICS = set()


def affinity(post_topic: int, community: int) -> int:
    return AFFINITY[post_topic][community]
