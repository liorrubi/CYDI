/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The first-run explanations for the three ways to play with other people.
//
// Data, not markup, so the copy can be asserted without mounting React - which
// is what pins the rule that matters here: the three lists are genuinely
// different, because the three situations are. A guest reading "start when
// everyone is ready" next to a button they do not have is worse than no
// tutorial at all.
export type TutorialStep = { icon: string; title: string; body: string };

export type TutorialRole = "host" | "guest" | "passPlay";

/**
 * Host and guest are told different things because they can do different
 * things - only the host has controls, and a guest reading "start when
 * everyone is ready" next to a button they do not have is worse than no
 * tutorial at all.
 *
 * Written for someone who has never played CYDI: nothing here assumes the
 * single-player game, the scoring page, or any CYDI vocabulary.
 */
/**
 * Host and guest are told different things because they can do different
 * things - only the host has controls, and a guest reading "start when
 * everyone is ready" next to a button they do not have is worse than no
 * tutorial at all.
 *
 * Written for someone who has never played CYDI: nothing here assumes the
 * single-player game, the scoring page, or any CYDI vocabulary.
 */
export const HOST_STEPS: TutorialStep[] = [
  { icon: "📨", title: "Create a room", body: "You are the host. Creating a room gives you a code that everyone else joins with." },
  { icon: "👋", title: "Invite your players", body: "Share the QR code, the link or the 6-character code. Friends join in a browser - no app and no account needed." },
  { icon: "▶️", title: "Start when everyone is ready", body: "Nobody can begin until you tap Start Game, so there is no rush while people arrive." },
  { icon: "👀", title: "Everyone gets the same shape", body: "The same shape appears for 3 seconds, then disappears. Everyone has 20 seconds to draw it from memory." },
  { icon: "⏭️", title: "You control the pace", body: "After each round everyone sees the scores, and the next round starts when you tap Next Round." },
];

export const GUEST_STEPS: TutorialStep[] = [
  { icon: "👋", title: "Join with your name", body: "Enter the code you were given and the name the others will see on the scoreboard." },
  { icon: "👀", title: "Remember the shape", body: "A shape appears for 3 seconds, then vanishes. Look carefully - you will not see it again." },
  { icon: "✏️", title: "Draw within 20 seconds", body: "Draw it from memory with your finger or mouse, and tap DONE as soon as you are happy." },
  { icon: "⚡", title: "Accuracy and speed decide the score", body: "75% of your score is how closely you matched the shape; 25% is how quickly you finished." },
  { icon: "🏆", title: "Highest total wins", body: "Scores add up across every round. Whoever has the most at the end is the CYDI Champion." },
];

/**
 * One device, taken in turns. The two things a first-timer gets wrong are
 * watching over the other player's shoulder, and not realising the phone has to
 * change hands - so both are said outright.
 */
export const PASS_PLAY_STEPS: TutorialStep[] = [
  { icon: "📱", title: "Take turns", body: "Two players share one device. You hand it over between turns, so look away when it is not your go." },
  { icon: "👀", title: "Same challenge", body: "Both players draw the same shape each round - but you each see it only at the start of your own turn." },
  { icon: "✏️", title: "Draw fast and accurately", body: "You get 20 seconds. Accuracy is what counts most, and finishing early adds a speed bonus." },
  { icon: "🏆", title: "Win the match", body: "Scores add up across every round, and the highest total at the end wins." },
];

export const STEPS_BY_ROLE: Record<TutorialRole, TutorialStep[]> = {
  host: HOST_STEPS,
  guest: GUEST_STEPS,
  passPlay: PASS_PLAY_STEPS,
};

export const LABEL_BY_ROLE: Record<TutorialRole, string> = {
  host: "How to host Play Together",
  guest: "How to play together",
  passPlay: "How to play 2 Players",
};
