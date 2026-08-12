import { useMemo } from 'preact/hooks';
import { renderMarkdown, stripTrailingIncompleteMarkdown } from '../utils/simple-markdown';

export interface BotMessageTextProps {
  content: string;
  /** True while chunks are still arriving for this message. */
  isStreaming?: boolean;
}

/**
 * Bot message body — markdown rendered, streaming or not.
 *
 * Rendering the raw string while streaming and only formatting on completion
 * looks fine for a text reply that lands in a second, but a voice turn arrives
 * one sentence at a time over the length of the spoken answer: the visitor
 * watches "[MNC PMS](https://…)" sit on screen for the whole reply and then
 * snap into a link at the end. So we format every chunk, and hide only the
 * unfinished tail (see stripTrailingIncompleteMarkdown).
 *
 * The parse is memoised on the content, so a re-render of the message list
 * costs nothing for messages that didn't change — this component sits inside a
 * keyed list, so Preact keeps one instance (and one cache) per message.
 */
export function BotMessageText({ content, isStreaming = false }: BotMessageTextProps) {
  const html = useMemo(
    () => renderMarkdown(isStreaming ? stripTrailingIncompleteMarkdown(content) : content),
    [content, isStreaming],
  );

  return (
    <div
      class="cw-message-text leading-relaxed"
      style={{ fontSize: '1em' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
