import Editor from '@monaco-editor/react';

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function YamlEditor({ value, onChange }: Props) {
  return (
    <Editor
      height="100%"
      language="yaml"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        renderWhitespace: 'boundary',
        automaticLayout: true,
      }}
    />
  );
}
