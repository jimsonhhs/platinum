import Editor, { type OnMount } from '@monaco-editor/react'

interface Props {
  value: string
  onChange: (value: string | undefined) => void
  onMount: OnMount
  editorTheme?: string
  readOnly?: boolean
  fontSize?: number
  fontFamily?: string
  lineSpacing?: number
}

export default function ContentEditor({ value, onChange, onMount, editorTheme, readOnly, fontSize, fontFamily, lineSpacing }: Props) {
  const fs = fontSize ?? 17
  const ls = lineSpacing ?? 1.75
  return (
    <Editor
      height="100%"
      language="plaintext"
      theme={editorTheme ?? 'light'}
      value={value}
      onChange={readOnly ? undefined : onChange}
      onMount={onMount}
      options={{
        minimap: { enabled: false },
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        readOnly: readOnly ?? false,
        scrollBeyondLastLine: false,
        renderLineHighlight: 'gutter', // 只高亮左侧行号槽背景（正文区绝不整行变色）
        // 关闭光标词高亮：中文无空格分词，整行会被当成一个词导致单击整行变色
        ...(({ wordHighlight: false, selectionHighlight: false }) as any),
        fontSize: fs,
        lineHeight: Math.round(fs * ls),
        fontFamily: fontFamily ?? "'Noto Serif SC', 'Source Han Serif SC', serif",
        wordWrap: 'on',
        automaticLayout: true,
        unicodeHighlight: { nonBasicASCII: false, ambiguousCharacters: false, invisibleCharacters: false },
        suggestOnTriggerCharacters: false,
        quickSuggestions: false,
        wordBasedSuggestions: 'off',
      }}
    />
  )
}
