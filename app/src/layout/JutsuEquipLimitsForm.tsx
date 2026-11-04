"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useJutsuEquipLimits } from "@/hooks/useJutsuEquipLimits";
import Loader from "@/layout/Loader";
import {
  equipLimitCategories,
  type JutsuEquipLimit,
  jutsuEquipLimitSchema,
} from "@/validators/jutsuEquipLimit";

/** Configure independent ranked and unranked category caps. */
export const JutsuEquipLimitsForm = () => {
  const { query, save, remove } = useJutsuEquipLimits();
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLFormElement>(null);
  const form = useForm<JutsuEquipLimit>({
    defaultValues: { category: "", unrankedMaxEquipped: null, rankedMaxEquipped: null },
    resolver: zodResolver(jutsuEquipLimitSchema),
  });
  const pending = save.isPending || remove.isPending;
  const feedback = {
    onSuccess: (result: { message: string }) => setMessage(result.message),
    onError: (error: { message: string }) => setMessage(error.message),
  };
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Jutsu Equip Limits</h3>
      <p className="text-sm text-muted-foreground">
        Zero blocks a category. Unlimited removes its cap. Changes apply when equipping
        or selecting loadouts and entering new battles.
      </p>
      {query.isPending ? (
        <Loader explanation="Loading equip limits" />
      ) : query.isError ? (
        <div role="alert">
          <p>Could not load equip limits.</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : (
        <>
          <table className="w-full text-center text-sm">
            <thead>
              <tr>
                <th>Tag/category</th>
                <th>Unranked</th>
                <th>Ranked</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.category} className="border-t">
                  <td>{row.category}</td>
                  <td>{row.unrankedMaxEquipped ?? "Unlimited"}</td>
                  <td>{row.rankedMaxEquipped ?? "Unlimited"}</td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        form.reset(row);
                        // Keep the editor reachable below long rule tables.
                        editorRef.current?.focus({ preventScroll: true });
                        editorRef.current?.scrollIntoView({ block: "start" });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        remove.mutate({ category: row.category }, feedback)
                      }
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
              ref={editorRef}
              aria-label="Jutsu equip limit editor"
              tabIndex={-1}
              className="space-y-3"
              onSubmit={form.handleSubmit((values) => save.mutate(values, feedback))}
            >
              <fieldset disabled={pending} className="space-y-3">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tag/category</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(category) => {
                          const row = query.data.find(
                            (entry) => entry.category === category,
                          );
                          form.reset(
                            row ?? {
                              category,
                              unrankedMaxEquipped: null,
                              rankedMaxEquipped: null,
                            },
                          );
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a tag or category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {equipLimitCategories.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(["unrankedMaxEquipped", "rankedMaxEquipped"] as const).map((name) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {name === "rankedMaxEquipped"
                            ? "Ranked limit"
                            : "Unranked limit"}
                        </FormLabel>
                        <label
                          htmlFor={`unlimited-${name}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            id={`unlimited-${name}`}
                            checked={field.value === null}
                            onCheckedChange={(checked) =>
                              field.onChange(checked === true ? null : 0)
                            }
                          />
                          Unlimited
                        </label>
                        <FormControl>
                          <NumberInput
                            {...field}
                            value={field.value ?? 0}
                            disabled={pending || field.value === null}
                            min={0}
                            step={1}
                            onValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
                <Button type="submit" disabled={pending}>
                  {save.isPending ? "Saving..." : "Save Limits"}
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
