"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import type { MutateContentSchema } from "@/validators/comments";
import { mutateContentSchema } from "@/validators/comments";

interface NindoChangeProps {
  userId: string;
  onChange: ({ content }: { content: string }) => void;
}

/**
 * Nindo change component
 */
export const NindoChange: React.FC<NindoChangeProps> = (props) => {
  // Queries
  const { data, isPending } = api.profile.getNindo.useQuery(
    { userId: props.userId },
    { enabled: !!props.userId },
  );

  // Form control
  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MutateContentSchema>({
    defaultValues: { content: data },
    resolver: zodResolver(mutateContentSchema),
  });

  // Handling submit
  const onSubmit = handleSubmit((data) => {
    props.onChange(data);
  });

  // Whenever new data is fetched, reset the form
  useEffect(() => {
    reset({ content: data });
  }, [data, reset]);

  if (isPending) return <Loader explanation="Loading nindo..." />;

  return (
    <form onSubmit={onSubmit}>
      <RichInput
        id="content"
        height="200"
        placeholder={data}
        control={control}
        onSubmit={onSubmit}
        error={errors.content?.message}
      />
    </form>
  );
};

export default NindoChange;
