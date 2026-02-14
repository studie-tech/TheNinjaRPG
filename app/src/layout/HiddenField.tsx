import type { UseFormRegister } from "react-hook-form";

interface HiddenFieldProps {
  id: string;
  value: string;
  register?: UseFormRegister<any>;
}

const HiddenField: React.FC<HiddenFieldProps> = (props) => {
  return (
    <input
      {...props?.register?.(props.id)}
      id={props.id}
      type="hidden"
      name="action"
      value={props.value}
    />
  );
};

export default HiddenField;
