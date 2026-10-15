export type LineageUpdate = (args: {
  data: { rerunTo: null }
  where: { id: string; rerunTo: string }
}) => Promise<unknown>
