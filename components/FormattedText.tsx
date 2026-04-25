import { Text } from 'react-native';

type Segment = { text: string; bold?: boolean; italic?: boolean };

function parseInlineMarkdown(source: string): Segment[] {
  const segments: Segment[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    if (match.index > last) segments.push({ text: source.slice(last, match.index) });
    if (match[2] != null) segments.push({ text: match[2], bold: true });
    else if (match[3] != null) segments.push({ text: match[3], italic: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last) });
  return segments;
}

export function FormattedText({ text, style }: { text: string; style: object }) {
  const lines = text.split('\n');

  return (
    <Text style={style}>
      {lines.map((line, li) => {
        const bulletMatch = line.match(/^(\s*)[-•]\s+/);
        const prefix = bulletMatch ? '  •  ' : '';
        const content = bulletMatch ? line.slice(bulletMatch[0].length) : line;
        const segments = parseInlineMarkdown(content);

        return (
          <Text key={li}>
            {li > 0 ? '\n' : ''}
            {prefix ? <Text>{prefix}</Text> : null}
            {segments.map((seg, si) => (
              <Text
                key={si}
                style={[
                  seg.bold && { fontWeight: '700' as const },
                  seg.italic && { fontStyle: 'italic' as const },
                ]}
              >
                {seg.text}
              </Text>
            ))}
          </Text>
        );
      })}
    </Text>
  );
}
