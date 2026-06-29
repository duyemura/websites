import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/style.css";
import "@blocknote/react/style.css";
import "@blocknote/mantine/style.css";
import { markdownToBlocks } from "@blocknote/core";
import type {
  BlockNoteEditor as BlockNoteEditorType,
  PartialBlock,
  Block,
} from "@blocknote/core";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BlockNoteEditorProps {
  content: string;
  onChange: (markdown: string) => void;
}

function getCurrentLevel(block: Block): number | undefined {
  return block.type === "heading"
    ? (block.props as { level: number }).level
    : undefined;
}

function Toolbar({
  editor,
  activeStyles,
  activeBlock,
}: {
  editor: BlockNoteEditorType;
  activeStyles: ReturnType<BlockNoteEditorType["getActiveStyles"]>;
  activeBlock: Block | null;
}) {
  const toggleStyle = (style: "bold" | "italic" | "underline" | "strike") => {
    editor.toggleStyles({ [style]: true });
    editor.focus();
  };

  const setBlockType = (
    type: "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "quote",
    level?: 1 | 2 | 3,
  ) => {
    const selection = editor.getSelection();
    const blocks = selection
      ? selection.blocks
      : [editor.getTextCursorPosition().block];

    for (const block of blocks) {
      const currentLevel = getCurrentLevel(block);
      const isSameType =
        block.type === type && (type !== "heading" || currentLevel === level);
      editor.updateBlock(
        block,
        isSameType
          ? { type: "paragraph" }
          : type === "heading"
            ? { type: "heading", props: { level } }
            : { type },
      );
    }
    editor.focus();
  };

  const blockType = activeBlock?.type;
  const blockLevel = activeBlock ? getCurrentLevel(activeBlock) : undefined;

  const ToolButton = ({
    active,
    onClick,
    icon: Icon,
    label,
  }: {
    active?: boolean;
    onClick: () => void;
    icon: React.ElementType;
    label: string;
  }) => (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className={cn("h-8 w-8", active && "bg-accent text-accent-foreground")}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b bg-muted/50 p-2"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1">
        <ToolButton
          label="Bold"
          icon={Bold}
          active={activeStyles.bold}
          onClick={() => toggleStyle("bold")}
        />
        <ToolButton
          label="Italic"
          icon={Italic}
          active={activeStyles.italic}
          onClick={() => toggleStyle("italic")}
        />
        <ToolButton
          label="Underline"
          icon={Underline}
          active={activeStyles.underline}
          onClick={() => toggleStyle("underline")}
        />
        <ToolButton
          label="Strikethrough"
          icon={Strikethrough}
          active={activeStyles.strike}
          onClick={() => toggleStyle("strike")}
        />
      </div>
      <div className="mx-1 h-5 w-px bg-border" />
      <div className="flex items-center gap-1">
        <ToolButton
          label="Heading 1"
          icon={Heading1}
          active={blockType === "heading" && blockLevel === 1}
          onClick={() => setBlockType("heading", 1)}
        />
        <ToolButton
          label="Heading 2"
          icon={Heading2}
          active={blockType === "heading" && blockLevel === 2}
          onClick={() => setBlockType("heading", 2)}
        />
        <ToolButton
          label="Heading 3"
          icon={Heading3}
          active={blockType === "heading" && blockLevel === 3}
          onClick={() => setBlockType("heading", 3)}
        />
      </div>
      <div className="mx-1 h-5 w-px bg-border" />
      <div className="flex items-center gap-1">
        <ToolButton
          label="Bullet list"
          icon={List}
          active={blockType === "bulletListItem"}
          onClick={() => setBlockType("bulletListItem")}
        />
        <ToolButton
          label="Numbered list"
          icon={ListOrdered}
          active={blockType === "numberedListItem"}
          onClick={() => setBlockType("numberedListItem")}
        />
        <ToolButton
          label="Quote"
          icon={Quote}
          active={blockType === "quote"}
          onClick={() => setBlockType("quote")}
        />
      </div>
    </div>
  );
}

export function BlockNoteEditor({ content, onChange }: BlockNoteEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: [{ type: "paragraph", content: "" }],
  });
  const previousContent = useRef(content);
  const [activeStyles, setActiveStyles] = useState<
    ReturnType<BlockNoteEditorType["getActiveStyles"]>
  >({});
  const [activeBlock, setActiveBlock] = useState<Block | null>(null);

  useEffect(() => {
    if (!editor || content === previousContent.current) return;
    previousContent.current = content;

    const blocks = markdownToBlocks(content || "", editor.pmSchema) as PartialBlock[];
    editor.replaceBlocks(editor.document, blocks);
  }, [content, editor]);

  const refreshToolbar = () => {
    setActiveStyles({ ...editor.getActiveStyles() });
    const selection = editor.getSelection();
    const block = selection
      ? selection.blocks[0]
      : editor.getTextCursorPosition().block;
    setActiveBlock(block);
  };

  if (!editor) {
    return <div className="rounded-md border bg-background p-4">Loading editor…</div>;
  }

  return (
    <div className="bn-container flex h-full flex-col rounded-md border bg-background">
      <Toolbar
        editor={editor}
        activeStyles={activeStyles}
        activeBlock={activeBlock}
      />
      <div className="flex-1 overflow-auto">
        <BlockNoteView
          editor={editor}
          onChange={() => {
            refreshToolbar();
            const markdown = editor.blocksToMarkdownLossy(editor.document);
            onChange(markdown);
          }}
        />
      </div>
    </div>
  );
}
