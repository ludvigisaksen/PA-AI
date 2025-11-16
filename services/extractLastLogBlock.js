// services/extractLastLogBlock.js

/**
 * Extract the last log block pasted by Ludvig before the trigger message
 * in a given channel.
 *
 * v1 heuristic:
 *   - Fetch last ~20 messages.
 *   - Take the latest message BEFORE trigger.createdTimestamp
 *     where author.id === ludvigId.
 *   - Return its content.
 *
 * This assumes you paste the full raw logs as one message.
 * If you later paste multi-message logs, this function can be expanded.
 */
export async function extractLastLogBlock(channel, triggerMessage, ludvigId) {
  const messages = await channel.messages.fetch({ limit: 20 });
  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  const candidates = sorted.filter(
    (m) =>
      m.id !== triggerMessage.id &&
      m.createdTimestamp < triggerMessage.createdTimestamp &&
      m.author &&
      m.author.id === ludvigId &&
      m.content &&
      m.content.trim().length > 0
  );

  if (!candidates.length) return null;

  const last = candidates[candidates.length - 1];
  return last.content;
}