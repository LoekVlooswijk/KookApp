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

function processLine(line: string): { content: string; isDivider?: boolean; headerLevel?: number } {
  const trimmed = line.trim();
  
  if (trimmed === '---' || trimmed === '___') {
    return { content: '', isDivider: true };
  }
  
  const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const headerText = headerMatch[2];
    return { content: headerText, headerLevel: level, isDivider: false };
  }
  
  return { content: line, isDivider: false };
}

export function FormattedText({ text, style }: { text: string; style?: object }) {
  const lines = text.split('\n');

  return (
    <Text style={style}>
      {lines.map((line, li) => {
        const processed = processLine(line);
        
        if (processed.isDivider) {
          return (
            <Text key={li}>
              {'\n'}
              {'─'.repeat(20)}
              {'\n'}
            </Text>
          );
        }
        
        const bulletMatch = processed.content.match(/^(\s*)[-•]\s+/);
        const prefix = bulletMatch ? '  •  ' : '';
        const content = bulletMatch ? processed.content.slice(bulletMatch[0].length) : processed.content;
        const segments = parseInlineMarkdown(content);
        
        const headerLevel = processed.headerLevel;
        const isHeader = headerLevel !== undefined;

        return (
          <Text key={li}>
            {li > 0 ? '\n' : ''}
            {prefix ? <Text>{prefix}</Text> : null}
            {segments.map((seg, si) => (
              <Text
                key={si}
                style={[
                  isHeader && { fontWeight: '700' as const, fontSize: (20 - headerLevel * 2) as number },
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
