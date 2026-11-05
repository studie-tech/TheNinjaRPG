import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { UserSearchResult, UserSearchSchema } from "@/validators/register";
import { getSearchValidator, userSearchSchema } from "@/validators/register";

/**
 * A hook which enables search in user names based on
 * input in a InputField, but which only searches upon a 500ms
 * delay after the user has stopped typing.
 */
export const useUserSearch = () => {
  // Use form for field
  const form = useForm<UserSearchSchema>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "" },
    mode: "all",
  });
  // Watch username field
  const watchUsername = useWatch({
    control: form.control,
    name: "username",
    defaultValue: "",
  });
  const searchTerm = useDebouncedValue(watchUsername);
  return { form, searchTerm };
};

/**
 * Form state behind a `UserSearchSelect`: pass `methods` as its `useFormMethods` and the same
 * `max` as its `maxUsers`. `users` is the live selection, starting from `defaultUsers`, and
 * `user` its first entry for single pickers.
 */
export const useUserPicker = (max = 1, defaultUsers: UserSearchResult[] = []) => {
  const schema = getSearchValidator({ max });
  const methods = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", users: defaultUsers },
  });
  const users = useWatch({
    control: methods.control,
    name: "users",
    defaultValue: defaultUsers,
  });
  return { methods, users, user: users[0] };
};

/**
 * Single `useUserPicker` that falls back to `self` whenever its selection is empty, for
 * purchases that default to the buyer. Clearing the selection therefore means "yourself".
 */
export const useRecipientPicker = (self: UserSearchResult | null | undefined) => {
  const picker = useUserPicker();
  const { methods, users } = picker;
  useEffect(() => {
    if (self && users.length === 0) methods.setValue("users", [self]);
  }, [self, users, methods]);
  return picker;
};
