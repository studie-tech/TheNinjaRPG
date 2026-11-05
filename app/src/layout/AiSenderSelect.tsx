import type React from "react";
import UserSearchSelect from "@/layout/UserSearchSelect";

/** Conversation sender picker for staff who may post as someone else. */
export const AiSenderSelect: React.FC<{
  methods: React.ComponentProps<typeof UserSearchSelect>["useFormMethods"];
}> = ({ methods }) => (
  <UserSearchSelect
    useFormMethods={methods}
    label="Post as (leave empty to post as yourself)"
    showYourself={true}
    showAi={true}
    inline={true}
    maxUsers={1}
  />
);
