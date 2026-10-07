// Starting points; every colour stays editable. Changing a colour switches the theme to "custom".
export const themes = {
  ligata:   { label: 'Ligata',   colorScheme: 'light', accent: '#2f5bff', accentText: '#ffffff', background: '#ffffff', surface: '#f3f4f8', text: '#15171f', mutedText: '#5d6272', userBubble: '#2f5bff', userText: '#ffffff', assistantBubble: '#f3f4f8', assistantText: '#15171f', radius: 20 },
  midnight: { label: 'Midnight', colorScheme: 'dark',  accent: '#8b7dff', accentText: '#14151c', background: '#14151c', surface: '#1e2029', text: '#f1f2f7', mutedText: '#a0a4b4', userBubble: '#8b7dff', userText: '#14151c', assistantBubble: '#1e2029', assistantText: '#f1f2f7', radius: 22 },
  ocean:    { label: 'Ocean',    colorScheme: 'light', accent: '#0e7c86', accentText: '#ffffff', background: '#fbfdfd', surface: '#ebf4f5', text: '#0f2a2e', mutedText: '#4d6a6e', userBubble: '#0e7c86', userText: '#ffffff', assistantBubble: '#ebf4f5', assistantText: '#0f2a2e', radius: 18 },
  forest:   { label: 'Forest',   colorScheme: 'light', accent: '#2f6b3f', accentText: '#ffffff', background: '#fcfcf9', surface: '#eef2ea', text: '#1a2a1e', mutedText: '#5a6b5d', userBubble: '#2f6b3f', userText: '#ffffff', assistantBubble: '#eef2ea', assistantText: '#1a2a1e', radius: 16 },
  sunset:   { label: 'Sunset',   colorScheme: 'light', accent: '#c9461f', accentText: '#ffffff', background: '#fffaf6', surface: '#fbeee6', text: '#2a1710', mutedText: '#7a5a4c', userBubble: '#c9461f', userText: '#ffffff', assistantBubble: '#fbeee6', assistantText: '#2a1710', radius: 24 },
  graphite: { label: 'Graphite', colorScheme: 'light', accent: '#111317', accentText: '#ffffff', background: '#ffffff', surface: '#f2f2f3', text: '#111317', mutedText: '#63666d', userBubble: '#111317', userText: '#ffffff', assistantBubble: '#f2f2f3', assistantText: '#111317', radius: 10 },
};
/** WCAG contrast ratio of two hex colours (1 to 21). */
export function contrast(a, b) {
  const lum = hex => {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const [r, g, bl] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = lum(a), y = lum(b);
  return x == null || y == null ? 21 : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Text and background pairs visitors read; each needs 4.5:1 (WCAG AA). */
export const readablePairs = [
  ['userText', 'userBubble', 'Visitor text on the visitor bubble'], ['assistantText', 'assistantBubble', 'Assistant text on the assistant bubble'],
  ['accentText', 'accent', 'Text on the accent colour'], ['text', 'background', 'Text on the panel'], ['mutedText', 'background', 'Secondary text on the panel'],
];
export const colorFields = [
  ['accent', 'Accent'], ['accentText', 'Text on accent'], ['background', 'Panel background'], ['surface', 'Input & cards'], ['text', 'Text'], ['mutedText', 'Secondary text'],
  ['userBubble', 'Visitor bubble'], ['userText', 'Visitor text'], ['assistantBubble', 'Assistant bubble'], ['assistantText', 'Assistant text'],
];
