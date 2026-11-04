"use client";

import { FilePlus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PET_ABILITY_SLOTS_BY_RARITY, PET_RANKS } from "@/drizzle/constants";
import type { PetSpecies } from "@/drizzle/schema";
import AiProfileEdit from "@/layout/AiProfileEdit";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Modal from "@/layout/Modal";
import { usePetSpeciesEditForm } from "@/libs/petSpecies";
import { PET_RANK_APPEARANCES } from "@/libs/pets/catalogue";
import { getTagSchema, IncreaseStatTag, tagTypes } from "@/validators/combat";
import {
  PetSpeciesValidator,
  type ZodPetSpeciesEffect,
  type ZodPetSpeciesType,
} from "@/validators/petSpecies";
import { PET_AI_ACTION_TYPES, PET_AI_EFFECT_TYPES } from "@/validators/pets";

/** Species provide authored defaults; every owned companion retains its own appearance and choices. */
export const SpeciesEditor = ({
  species,
  onSaved,
}: {
  species: PetSpecies;
  onSaved: () => void | Promise<void>;
}) => {
  const editor = usePetSpeciesEditForm(species, onSaved);
  return <SpeciesForm editor={editor} isNew={false} />;
};

/** Keep a pending creation open so a rejection returns to the same editable draft. */
export const CreateSpeciesModal = ({
  setIsOpen,
}: {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const editor = usePetSpeciesEditForm(undefined, () => setIsOpen(false));
  return (
    <Modal
      title="New companion species"
      isOpen
      setIsOpen={setIsOpen}
      isLoading={editor.isSaving}
      className="sm:max-w-4xl"
    >
      <SpeciesForm editor={editor} isNew />
    </Modal>
  );
};

/** Edit species defaults while preserving each tag's recipients through the shared combat editor. */
const SpeciesForm = ({
  editor,
  isNew,
}: {
  editor: ReturnType<typeof usePetSpeciesEditForm>;
  isNew: boolean;
}) => {
  const [tab, setTab] = useState("general");
  const { form, formData, handleSubmit, isActive, isSaving, message, effects } = editor;
  const validEffects = effects.filter(
    (effect): effect is ZodPetSpeciesEffect => effect !== undefined,
  );
  // Combat schemas strip species-only recipients; the setter merges them back by index.
  // Stable stripped inputs keep the shared editor's form synchronization from repeating.
  const combatEffects = useMemo(
    () =>
      effects
        .filter((effect): effect is ZodPetSpeciesEffect => effect !== undefined)
        .map(({ skillTarget: _target, ...effect }) => effect),
    [effects],
  );
  const setEffects = (values: ZodPetSpeciesEffect[]) =>
    form.setValue("effects", values, { shouldDirty: true });
  const contentForm = form as unknown as UseFormReturn<ZodPetSpeciesType>;
  return (
    <fieldset disabled={isSaving} className="min-w-0">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 grid grid-cols-5">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="artwork">Artwork</TabsTrigger>
          <TabsTrigger value="loadout">Loadout</TabsTrigger>
          <TabsTrigger value="skills">Pet skills</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>
        <TabsContent value="general" forceMount hidden={tab !== "general"}>
          <p className="mb-4 text-muted-foreground text-sm">
            Describe the animal&apos;s appearance for its generated portrait. Rarity
            affects daily availability and jutsu slots. Role describes its playstyle;
            authored jutsu and AI instructions determine its behavior.
          </p>
          <EditContent
            schema={PetSpeciesValidator}
            form={contentForm}
            formData={formData}
            showSubmit={false}
            onAccept={handleSubmit}
            submitLoading={isSaving}
          >
            <p className="col-span-full text-muted-foreground text-sm">
              {isActive
                ? "This species can appear in new daily offers."
                : "This species is retired from new daily offers."}{" "}
              Existing companions keep their species and generated portraits.
            </p>
          </EditContent>
        </TabsContent>
        <TabsContent value="artwork" forceMount hidden={tab !== "artwork"}>
          <p className="mb-4 text-muted-foreground text-sm">
            Steer this species&apos; generated portraits. Art direction adds a
            species-wide look and style to every portrait; each rank concept describes
            what that evolution adds, and a blank rank uses the built-in milestone shown
            as its placeholder. Changes apply to portraits generated after saving.
          </p>
          <ArtworkFields form={contentForm} />
        </TabsContent>
        <TabsContent value="loadout" forceMount hidden={tab !== "loadout"}>
          <p className="mb-4 text-muted-foreground text-sm">
            This rarity has {PET_ABILITY_SLOTS_BY_RARITY[editor.rarity]} jutsu slots.
            Defaults are copied to newly acquired companions and remain editable by
            their owners. Rank, level and power limits still apply.
          </p>
          {editor.catalogue.isError && (
            <p role="alert">
              Could not load pet jutsu.{" "}
              <Button variant="link" onClick={() => void editor.catalogue.refetch()}>
                Try again
              </Button>
            </p>
          )}
          <EditContent
            schema={PetSpeciesValidator}
            form={contentForm}
            formData={editor.loadoutFormData}
            showSubmit={false}
            onAccept={handleSubmit}
            submitLoading={isSaving || editor.catalogue.isPending}
          />
          {editor.catalogue.hasNextPage && (
            <Button
              variant="outline"
              disabled={editor.catalogue.isFetchingNextPage}
              onClick={() => void editor.catalogue.fetchNextPage()}
            >
              Load more pet jutsu
            </Button>
          )}
        </TabsContent>
        <TabsContent value="skills" forceMount hidden={tab !== "skills"}>
          <p className="mb-4 text-muted-foreground text-sm">
            Each tag applies once at battle start. Self tags affect the participating
            companion and its owner; enemy tags affect opposing combatants. Choose a
            target for each tag. These bonuses require the companion to participate in
            an eligible battle.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              setEffects([
                ...validEffects,
                { ...IncreaseStatTag.parse({}), skillTarget: "SELF" },
              ])
            }
          >
            <FilePlus className="mr-2 h-4 w-4" />
            Add pet skill tag
          </Button>
          <div className="mt-3 space-y-3">
            {validEffects.map((effect, index) => (
              <div key={`${effect.type}-${index}`} className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <strong>Pet skill tag {index + 1}</strong>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove pet skill tag ${index + 1}`}
                    onClick={() =>
                      setEffects(validEffects.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Form {...contentForm}>
                  <FormField
                    control={contentForm.control}
                    name={`effects.${index}.skillTarget`}
                    render={({ field }) => (
                      <FormItem className="mb-3">
                        <FormLabel>Pet skill target</FormLabel>
                        <Select
                          value={field.value ?? "SELF"}
                          onValueChange={field.onChange}
                          disabled={isSaving}
                        >
                          <FormControl>
                            <SelectTrigger
                              aria-label={`Pet skill tag ${index + 1} target`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="SELF">
                              Self (companion and owner)
                            </SelectItem>
                            <SelectItem value="ENEMIES">Enemies</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Form>
                <EffectFormWrapper
                  idx={index}
                  type="skillTree"
                  tag={combatEffects[index]!}
                  effects={combatEffects}
                  setEffects={(values) =>
                    setEffects(
                      values.map((value, i) => ({
                        ...value,
                        skillTarget: validEffects[i]?.skillTarget ?? "SELF",
                      })),
                    )
                  }
                  editableFields={Object.keys(getTagSchema(effect.type).shape).filter(
                    (field) => field !== "target" && field !== "coordinateTargeting",
                  )}
                  availableTags={tagTypes.filter(
                    // Innate skills cannot select empty ground or invoke system-only sage activation.
                    (type) =>
                      type !== "move" &&
                      type !== "barrier" &&
                      type !== "activatesagemode",
                  )}
                  submitLoading={isSaving}
                />
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="ai" forceMount hidden={tab !== "ai"}>
          <p className="mb-4 text-muted-foreground text-sm">
            Save the species profile to set the instructions copied to new companions.
            Existing owners keep their own instructions.
          </p>
          <AiProfileEdit
            userData={{
              userId: "species-default",
              aiProfileId: null,
              jutsus: [],
              items: [],
            }}
            availableActionTypes={PET_AI_ACTION_TYPES}
            availableActionEffects={PET_AI_EFFECT_TYPES}
            configuration={{
              profile: editor.aiProfile,
              isSaving,
              onSave: (profile) => {
                form.setValue("aiRules", profile.rules, { shouldDirty: true });
                form.setValue("includeDefaultRules", profile.includeDefaultRules, {
                  shouldDirty: true,
                });
                void handleSubmit();
              },
            }}
          />
        </TabsContent>
      </Tabs>
      {message && (
        <p role="alert" className="mt-3 text-destructive text-sm">
          {message}
        </p>
      )}
      {tab !== "ai" && (
        <Button
          className="mt-4"
          disabled={isSaving || (!isNew && !form.formState.isDirty)}
          onClick={() => void handleSubmit()}
        >
          {isSaving ? "Saving" : isNew ? "Create species" : "Save to Database"}
        </Button>
      )}
    </fieldset>
  );
};

/** Species art direction plus one optional concept per rank, falling back to built-in milestones. */
const ArtworkFields = ({ form }: { form: UseFormReturn<ZodPetSpeciesType> }) => (
  <Form {...form}>
    <div className="grid gap-3">
      <FormField
        control={form.control}
        name="artDirection"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel htmlFor="artDirection">Art direction (optional)</FormLabel>
            <FormControl>
              <Textarea
                id="artDirection"
                rows={4}
                placeholder="Overall look for every companion of this species, e.g. fur colour, markings, ornaments and style."
                isDirty={fieldState.isDirty}
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {PET_RANKS.map(({ rank, name }) => (
        <FormField
          key={rank}
          control={form.control}
          name={`rankConcepts.${rank - 1}`}
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={`rankConcept-${rank}`}>
                Rank {rank} concept ({name})
              </FormLabel>
              <FormControl>
                <Textarea
                  id={`rankConcept-${rank}`}
                  rows={3}
                  placeholder={PET_RANK_APPEARANCES[rank - 1]}
                  isDirty={fieldState.isDirty}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  </Form>
);
