const POST_POOL = {
  crowd: [
    { topic: 0, title: "Cat Loaf Gallery", desc: "Cats sitting like perfect bread loaves. Pure zen." },
    { topic: 1, title: "Golden Retriever Smile", desc: "A golden retriever smiling at absolutely nothing. Instant serotonin." },
    { topic: 2, title: "Tiny Mouse Eating", desc: "A mouse delicately nibbling on a piece of cheese twice its size." },
    { topic: 3, title: "Parrot Dancing", desc: "A parrot vibing to music with better rhythm than most humans." },
  ],
  niche: [
    { topic: 0, title: "Cat Parkour", desc: "A cat doing impossible wall jumps in slow motion." },
    { topic: 1, title: "Dog Agility Run", desc: "A border collie destroying an obstacle course in record time." },
    { topic: 2, title: "Mouse Maze Champion", desc: "A mouse solving an insanely complex DIY maze for cheese." },
    { topic: 3, title: "Bird Mimics Phone", desc: "A bird perfectly copying an iPhone ringtone. Uncanny." },
  ],
  hot: [
    { topic: 0, title: "Cats Are Smarter", desc: "A bold claim that cats are smarter than dogs. Fight!" },
    { topic: 1, title: "Dogs Are Better Pets", desc: "An emotional video 'proving' dogs are the best pets ever. No debate." },
    { topic: 2, title: "Mice Are Underrated", desc: "Hot take: mice are cleaner and smarter than hamsters. Shots fired." },
    { topic: 3, title: "Birds Shouldn't Be Caged", desc: "Keeping birds in cages is cruel. Change my mind." },
  ],
};

const BADGE_COLORS = {
  crowd: "rgb(80,140,230)",
  niche: "rgb(170,90,220)",
  hot:   "rgb(230,80,80)",
};

const BADGE_LABEL = {
  crowd: "Crowd-Pleaser",
  niche: "Niche Hit",
  hot:   "Hot Take",
};

const POST_ORDER = ["crowd", "niche", "hot"];

function drawPosts(rng) {
  return POST_ORDER.map(kind => {
    const pool = POST_POOL[kind];
    const post = pool[rng.randInt(0, pool.length - 1)];
    return { ...post, kind };
  });
}
