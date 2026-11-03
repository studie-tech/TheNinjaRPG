"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSharedCooldowns } from "@/hooks/useSharedCooldowns";
import Loader from "@/layout/Loader";
import { tagTypes } from "@/validators/combat";
import { sharedCooldownSchema } from "@/validators/sharedCooldown";

/** Manage tag cooldowns applied to newly initiated battles. */
export const SharedCooldownForm = () => {
  const { query, save, remove } = useSharedCooldowns();
  const [message, setMessage] = useState("");
  const form = useForm<z.infer<typeof sharedCooldownSchema>>({
    defaultValues: { tag: "", rounds: 1 },
    resolver: zodResolver(sharedCooldownSchema),
  });
  const pending = save.isPending || remove.isPending;
  const feedback = {
    onSuccess: (result: { message: string }) => setMessage(result.message),
    onError: (error: { message: string }) => setMessage(error.message),
  };
  return (
    <section className="mt-6 space-y-3 border-t pt-4">
      <h3 className="text-lg font-semibold">Shared Cooldowns</h3>
      <p className="text-muted-foreground text-sm">
        Changes apply to new battles. When actions share multiple tags, the longest
        matching cooldown applies.
      </p>
      {query.isPending ? (
        <Loader explanation="Loading shared cooldowns" />
      ) : query.isError ? (
        <div role="alert">
          <p>Could not load shared cooldowns.</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Tag</th>
                <th>GCD rounds</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.tag} className="border-t">
                  <td>{row.tag}</td>
                  <td className="text-center">{row.rounds}</td>
                  <td className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => form.reset(row)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove.mutate({ tag: row.tag }, feedback)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Form {...form}>
            <form
              className="space-y-3"
              onSubmit={form.handleSubmit((values) => save.mutate(values, feedback))}
            >
              <fieldset disabled={pending} className="space-y-3">
                <FormField
                  control={form.control}
                  name="tag"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tag to add or edit</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(tag) => {
                          field.onChange(tag);
                          const row = query.data.find((entry) => entry.tag === tag);
                          form.setValue("rounds", row?.rounds ?? 1);
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a tag" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tagTypes.map((tag) => (
                            <SelectItem key={tag} value={tag}>
                              {tag}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rounds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GCD rounds</FormLabel>
                      <FormControl>
                        <NumberInput
                          {...field}
                          min={1}
                          step={1}
                          onValueChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={pending}>
                  {save.isPending ? "Saving..." : "Save Tag"}
                </Button>
              </fieldset>
            </form>
          </Form>
        </>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
};
