// Flashcards are not a second set of content: every card is a question from questions.json, shown as front and back.
// Open and fill-in questions are cards by default. Multiple-choice and true/false questions are cards only when
// flashcards.json lists them in "include" (definitions and key terms); "exclude" removes any question from the deck.
// No DOM in here, so tools/validate.mjs can use it too.

/** The one correct answer as text. */
export function answerText(q) {
  if (q.type === 'mc') return q.options[q.answer];
  if (q.type === 'tf') return q.answer ? 'True' : 'False';
  if (q.type === 'fill') return q.answers[0];
  return q.modelAnswer;
}

export function buildCards(questions, config = {}) {
  const include = new Set(config.include || []);
  const exclude = new Set(config.exclude || []);
  return questions
    .filter((q) => !exclude.has(q.id) && (q.type === 'open' || q.type === 'fill' || include.has(q.id)))
    .map((q) => ({ id: q.id, topic: q.topic, type: q.type, front: q.question, back: answerText(q), explanation: q.explanation, flag: q.flag, src: q.src }));
}
