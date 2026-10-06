// Starting points; every colour stays editable. Changing a colour switches the theme to "custom".
export const themes = {
  ligata:   { label: 'Ligata',   colorScheme: 'light', accent: '#2f5bff', accentText: '#ffffff', background: '#ffffff', surface: '#f3f4f8', text: '#15171f', mutedText: '#5d6272', userBubble: '#2f5bff', userText: '#ffffff', assistantBubble: '#f3f4f8', assistantText: '#15171f', radius: 20 },
  midnight: { label: 'Midnight', colorScheme: 'dark',  accent: '#8b7dff', accentText: '#ffffff', background: '#14151c', surface: '#1e2029', text: '#f1f2f7', mutedText: '#a0a4b4', userBubble: '#8b7dff', userText: '#ffffff', assistantBubble: '#1e2029', assistantText: '#f1f2f7', radius: 22 },
  ocean:    { label: 'Ocean',    colorScheme: 'light', accent: '#0e7c86', accentText: '#ffffff', background: '#fbfdfd', surface: '#ebf4f5', text: '#0f2a2e', mutedText: '#4d6a6e', userBubble: '#0e7c86', userText: '#ffffff', assistantBubble: '#ebf4f5', assistantText: '#0f2a2e', radius: 18 },
  forest:   { label: 'Forest',   colorScheme: 'light', accent: '#2f6b3f', accentText: '#ffffff', background: '#fcfcf9', surface: '#eef2ea', text: '#1a2a1e', mutedText: '#5a6b5d', userBubble: '#2f6b3f', userText: '#ffffff', assistantBubble: '#eef2ea', assistantText: '#1a2a1e', radius: 16 },
  sunset:   { label: 'Sunset',   colorScheme: 'light', accent: '#e2552d', accentText: '#ffffff', background: '#fffaf6', surface: '#fbeee6', text: '#2a1710', mutedText: '#7a5a4c', userBubble: '#e2552d', userText: '#ffffff', assistantBubble: '#fbeee6', assistantText: '#2a1710', radius: 24 },
  graphite: { label: 'Graphite', colorScheme: 'light', accent: '#111317', accentText: '#ffffff', background: '#ffffff', surface: '#f2f2f3', text: '#111317', mutedText: '#63666d', userBubble: '#111317', userText: '#ffffff', assistantBubble: '#f2f2f3', assistantText: '#111317', radius: 10 },
};
export const colorFields = [
  ['accent', 'Accent'], ['accentText', 'Text on accent'], ['background', 'Panel background'], ['surface', 'Input & cards'], ['text', 'Text'], ['mutedText', 'Secondary text'],
  ['userBubble', 'Visitor bubble'], ['userText', 'Visitor text'], ['assistantBubble', 'Assistant bubble'], ['assistantText', 'Assistant text'],
];
