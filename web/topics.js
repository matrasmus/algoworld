const TOPICS = [
  { id: 0, name: "Cats",  color: "rgb(240,160,60)",  rgb: [240, 160, 60] },
  { id: 1, name: "Dogs",  color: "rgb(100,180,240)", rgb: [100, 180, 240] },
  { id: 2, name: "Mice",  color: "rgb(180,130,210)", rgb: [180, 130, 210] },
  { id: 3, name: "Birds", color: "rgb(80,210,80)",   rgb: [80, 210, 80] },
];

const NUM_TOPICS = TOPICS.length;

//                Cats  Dogs  Mice  Birds
const AFFINITY = [
  [ 2,  -1,  +1,  +1],  // Cats
  [-1,   2,  -1,  +1],  // Dogs
  [-1,  -1,   2,  +1],  // Mice
  [-1,  +1,  +1,   2],  // Birds
];

function affinity(postTopic, community) {
  return AFFINITY[postTopic][community];
}
