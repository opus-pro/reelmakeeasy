export interface MarkdownSerializer<Node> {
  fromMarkdownString(markdown: string): Node
  toMarkdownString(node: Node): string
}
