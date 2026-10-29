// Adapted from OpenWork v0.18.63 (MIT). See THIRD-PARTY-NOTICES.md.
import * as Primitive from "react-resizable-panels";
export function PanelGroup(props: Primitive.GroupProps) {
  return (
    <Primitive.Group
      {...props}
      className={`panel-group ${props.className ?? ""}`}
    />
  );
}
export function Panel(props: Primitive.PanelProps) {
  return <Primitive.Panel {...props} />;
}
export function Separator(props: Primitive.SeparatorProps) {
  return <Primitive.Separator {...props} className="panel-separator" />;
}
