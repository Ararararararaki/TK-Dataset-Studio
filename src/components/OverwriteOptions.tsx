type Props = {
  overwrite: boolean;
  backup: boolean;
  onChange: (change: { overwrite?: boolean; backup_before_overwrite?: boolean }) => void;
};

export default function OverwriteOptions({ overwrite, backup, onChange }: Props) {
  return <div className="overwrite-options">
    <label className="check-field">
      <input type="checkbox" checked={overwrite} onChange={(e) => onChange({ overwrite: e.target.checked })} />
      <span>覆盖已有文本<small>默认跳过已有 TXT，开启后重新打标并替换</small></span>
    </label>
    <label className="check-field">
      <input type="checkbox" checked={backup} onChange={(e) => onChange({ backup_before_overwrite: e.target.checked })} />
      <span>覆盖前备份 TXT<small>{backup ? "替换或编辑已有文本时，另存原 TXT" : "不生成额外备份文件；修改历史仍保留"}</small></span>
    </label>
  </div>;
}
