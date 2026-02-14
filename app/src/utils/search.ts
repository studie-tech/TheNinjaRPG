import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import type { UserSearchSchema } from "@/validators/register";
import { userSearchSchema } from "@/validators/register";

/**
 * A hook which enables search in user names based on
 * input in a InputField, but which only searches upon a 500ms
 * delay after the user has stopped typing.
 */
export const useUserSearch = () => {
  // Search term
  const [searchTerm, setSearchTerm] = useState<string>("");
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
  // Update search term with delay
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setSearchTerm(watchUsername);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchUsername, setSearchTerm]);
  return { form, searchTerm };
};

/**
 * A hook which enables search in user IPs based on
 * input in a InputField, but which only searches upon a 500ms
 * delay after the user has stopped typing.
 */
export const useFieldSearch = () => {
  // Search term
  const [searchTerm, setSearchTerm] = useState<string>("");
  // Types
  const searchSchema = z.object({ term: z.string() });
  type SearchSchema = z.infer<typeof searchSchema>;
  // Use form for field
  const form = useForm<SearchSchema>({
    resolver: zodResolver(searchSchema),
    defaultValues: { term: "" },
    mode: "all",
  });
  // Watch username field
  const watchedValue = useWatch({
    control: form.control,
    name: "term",
    defaultValue: "",
  });
  // Update search term with delay
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setSearchTerm(watchedValue);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchedValue, setSearchTerm]);
  return { form, searchTerm };
};
