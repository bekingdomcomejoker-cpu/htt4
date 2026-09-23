import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

type ChatMessageContentProps = {
  content: string;
  className?: string;
};

function copyToClipboard(value: string) {
  return navigator.clipboard?.writeText(value);
}

export function ChatMessageContent({ content, className }: ChatMessageContentProps) {
  const [copied, setCopied] = useState(false);
  const copyMessage = async () => {
    await copyToClipboard(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={`chat-markdown ${className || ""}`}>
      <div className="chat-message-actions">
        <button type="button" className="chat-copy-button" onClick={() => void copyMessage()} aria-label="Copy message">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const value = String(children).replace(/\n$/, "");
            const isBlock = Boolean(codeClassName) || String(children).includes("\n");
            const [codeCopied, setCodeCopied] = useState(false);
            if (!isBlock) return <code className={codeClassName} {...props}>{children}</code>;
            return (
              <div className="chat-code-block">
                <div className="chat-code-toolbar">
                  <span>{codeClassName?.replace("language-", "") || "code"}</span>
                  <button type="button" className="chat-copy-button" onClick={() => { void copyToClipboard(value); setCodeCopied(true); window.setTimeout(() => setCodeCopied(false), 1400); }} aria-label="Copy code block">
                    {codeCopied ? <Check size={12} /> : <Copy size={12} />}
                    {codeCopied ? "Copied" : "Copy code"}
                  </button>
                </div>
                <pre><code className={codeClassName} {...props}>{children}</code></pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
