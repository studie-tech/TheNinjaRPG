"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import AutoHeight from "embla-carousel-auto-height";
import { ArrowRight, MonitorPlay } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { startTransition, useEffect, useState } from "react";
import { type UseFormReturn, useForm, useFormState, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { CarouselApi } from "@/components/ui/carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMG_REGISTRATIN_STEP1,
  IMG_REGISTRATIN_STEP2,
  IMG_REGISTRATIN_STEP8,
  IMG_REGISTRATIN_STEP9,
} from "@/drizzle/constants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CharacterPreview } from "@/layout/CharacterPreview";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { trackConversion } from "@/libs/conversionTracking";
import {
  firstInvalidRegistrationStep,
  registrationStepReadiness,
} from "@/libs/registration";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { getRandomElement, shuffle } from "@/utils/array";
import { isRetryableTrpcError } from "@/utils/error";
import { secureRandomInt } from "@/utils/math";
import { safeLocalStorageGetItem } from "@/utils/storage";
import { useUserDataSelector, useUserInfo } from "@/utils/UserContext";
import {
  attributes,
  colors,
  genders,
  getAttributeGroup,
  type RegistrationSchema,
  registrationSchema,
  skin_colors,
} from "@/validators/register";

/**
 * Wrapper component that handles the loading state and authenticated user redirect.
 * This separation ensures consistent hook counts in the form component.
 */
const Register: React.FC = () => {
  const router = useRouter();
  const utils = api.useUtils();
  const {
    data: userData,
    status: userStatus,
    isClerkLoaded,
    isSignedIn,
  } = useUserDataSelector((profile) => ({ userId: profile.userId }));

  // Redirect authenticated users away from register page
  useEffect(() => {
    if (isClerkLoaded && !isSignedIn) {
      void router.replace("/login");
    } else if (userStatus === "success" && userData) {
      void router.push("/");
    }
  }, [router, userStatus, userData, isClerkLoaded, isSignedIn]);

  // Show loader while checking auth status or if user is authenticated
  const isLoading =
    !isClerkLoaded ||
    !isSignedIn ||
    userStatus === "pending" ||
    (userStatus === "success" && !!userData);

  if (!isLoading && userStatus === "error") {
    return (
      <ContentBox title="Connection interrupted">
        <p className="p-4">We couldn&apos;t load your account. Please try again.</p>
        <Button className="m-4" onClick={() => void utils.profile.getUser.invalidate()}>
          Try again
        </Button>
      </ContentBox>
    );
  }

  // The loading state is the form's own first step with a loader in place of its fields,
  // so the step banner, the page's largest image, is one element from the prerendered HTML
  // to the filled-in form: it paints without waiting for clerk-js and the user query, and
  // is neither replaced nor shifted when the fields arrive.
  return <RegisterForm isLoading={isLoading} />;
};

const REGISTER_BOX = {
  title: "Create your Ninja",
  subtitle: "And unlock the mysteries of Seichi",
  padding: false,
} as const;

const REGISTER_CAROUSEL_OPTIONS: React.ComponentProps<typeof Carousel>["opts"] = {
  watchResize: (api, entries) => {
    const slides = api.slideNodes();
    const { slideRects } = api.internalEngine();
    // AutoHeight caches step heights. Refresh for async content and form feedback;
    // container height changes come from the plugin itself.
    const hasHeightChange = entries.some(({ target }) => {
      const index = slides.findIndex((slide) => slide === target);
      return index !== -1 && slides[index]?.offsetHeight !== slideRects[index]?.height;
    });
    if (!hasHeightChange) return true;
    api.reInit();
    return false;
  },
};

/**
 * The registration form component.
 * Holds the form and its mutations; each step subscribes only to the fields it shows, so a
 * change re-renders that step rather than the whole carousel.
 */
const RegisterForm: React.FC<{ isLoading: boolean }> = ({ isLoading }) => {
  // tRPC utility
  const utils = api.useUtils();

  // Clerk user id, stored as the new character's userId (for GTM event)
  const { userId } = useUserInfo();

  // Create avatar mutation
  const createAvatar = api.avatar.createAvatar.useMutation();

  // Why the last submission failed, kept on the final step after the toast has gone
  const [failureMessage, setFailureMessage] = useState<string>();

  // Create character mutation. The global mutation error handler keeps showing its toast,
  // which a caller's onError would replace, so the failure is read in onSettled.
  const { mutate: createCharacter, isPending } =
    api.register.createCharacter.useMutation({
      onSuccess: async (data) => {
        if (data.success) {
          // Publish the confirmed receipt before cache reconciliation can fail.
          trackConversion("register", data.registrationId ?? userId ?? undefined);
          await utils.profile.getUser.invalidate();
          createAvatar.mutate();
        } else {
          showMutationToast(data);
        }
      },
      onSettled: (data, error) => setFailureMessage(getFailureMessage(data, error)),
    });

  // Prepare initial randomized defaults for style-related fields
  // Using useState with lazy initialization to ensure values are computed only once
  // Note: the prerendered HTML is always the loading state, which shows no field, so
  // randomizing here causes no hydration mismatch
  const [initialFormValues] = useState(() => getRandomizedFormValues());

  // Form handling
  const form = useForm({
    mode: "all",
    reValidateMode: "onChange",
    criteriaMode: "all",
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      username: "",
      gender: initialFormValues.gender,
      spriteBodyStyle: undefined,
      hair_color: initialFormValues.hair_color,
      eye_color: initialFormValues.eye_color,
      skin_color: initialFormValues.skin_color,
      attribute_1: initialFormValues.attribute_1,
      attribute_2: initialFormValues.attribute_2,
      attribute_3: initialFormValues.attribute_3,
      bloodlineId: undefined,
      musicOn: true,
      sfxOn: true,
      buttonSfxOn: true,
    },
  });

  // Set localStorage-based values once mounted (can't access localStorage during SSR/initial render)
  useEffect(() => {
    form.setValue("musicOn", getLocalStorageBoolean("musicOn", true));
    form.setValue("sfxOn", getLocalStorageBoolean("sfxOn", true));
    form.setValue("buttonSfxOn", getLocalStorageBoolean("buttonSfxOn", true));
  }, [form]);

  // If we have local storage referrer, set it as default value
  useEffect(() => {
    const referrer = safeLocalStorageGetItem("ref");
    if (referrer) {
      form.setValue("recruiter_userid", referrer);
    }
  }, [form]);

  // Carousel holding the current step, owned here so an invalid submit can return to it
  const [cApi, setCApi] = useState<CarouselApi>();

  // Handle form submission. An invalid submit returns to the first step with an error,
  // where each field shows its message inline.
  const handleCreateCharacter = form.handleSubmit(
    (data) => createCharacter(data),
    (errors) => {
      const invalid = firstInvalidRegistrationStep(Object.keys(errors));
      if (!invalid) return;
      cApi?.scrollTo(invalid.step);
      showMutationToast({
        success: false,
        title: `Step ${invalid.step + 1} needs attention`,
        message: `Please check: ${invalid.labels.join(", ")}`,
        id: "register-invalid",
      });
    },
  );

  // The steps stay mounted while creating, only hidden, because the carousel holds the
  // current step: a rejected submission has to come back to the step it was sent from.
  return (
    <ContentBox {...REGISTER_BOX}>
      <div className="relative">
        <Form {...form}>
          <form
            onSubmit={handleCreateCharacter}
            className={cn("relative", isPending && "invisible")}
          >
            <RegisterSteps
              cApi={cApi}
              setCApi={setCApi}
              form={form}
              isLoading={isLoading}
              failureMessage={failureMessage}
            />
          </form>
        </Form>
        {isPending && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader explanation="Creating character..." />
          </div>
        )}
      </div>
    </ContentBox>
  );
};

/** Carousel of registration steps; while loading, the first step's banner and a loader */
const RegisterSteps: React.FC<{
  cApi: CarouselApi | undefined;
  setCApi: (api: CarouselApi) => void;
  form: RegisterFormApi;
  isLoading: boolean;
  failureMessage: string | undefined;
}> = ({ cApi, setCApi, form, isLoading, failureMessage }) => {
  // Carousel state
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  // Size each step to its content instead of reserving space for the tallest step.
  const plugins = React.useMemo(() => [AutoHeight()], []);

  // Carousel control. The step counter renders in a transition so the slide animation
  // starts without waiting for it; reInit fires when the steps after the first mount.
  useEffect(() => {
    if (!cApi) return;
    const onSelect = () => {
      startTransition(() => {
        setCount(cApi.scrollSnapList().length);
        setCurrent(cApi.selectedScrollSnap() + 1);
      });
    };
    onSelect();
    cApi.on("select", onSelect);
    cApi.on("reInit", onSelect);
    return () => {
      cApi.off("select", onSelect);
      cApi.off("reInit", onSelect);
    };
  }, [cApi]);

  return (
    <>
      <Carousel setApi={setCApi} plugins={plugins} opts={REGISTER_CAROUSEL_OPTIONS}>
        <CarouselContent className="items-start">
          <CarouselItem className="flex flex-col gap-4">
            <StepBanner alt="step1" src={IMG_REGISTRATIN_STEP1} />
            {isLoading ? (
              <Loader explanation="Loading page..." />
            ) : (
              <IdentityStep form={form} />
            )}
          </CarouselItem>
          {!isLoading && (
            <>
              <CarouselItem className="relative flex flex-col gap-4">
                <StepBanner alt="step2" src={IMG_REGISTRATIN_STEP2} />
                <AppearanceStep form={form} />
              </CarouselItem>
              <CarouselItem className="flex flex-col gap-4">
                <StepBanner alt="step3" src={IMG_REGISTRATIN_STEP8} />
                <BloodlineStep form={form} />
              </CarouselItem>
              <CarouselItem className="flex flex-col items-center gap-4">
                <StepBanner alt="step4" src={IMG_REGISTRATIN_STEP9} />
                <AgreementStep form={form} failureMessage={failureMessage} />
              </CarouselItem>
            </>
          )}
        </CarouselContent>
        <CarouselPrevious className="animate-[wiggle_1s_ease-in-out_infinite]" />
        <StepGatedCarouselNext form={form} current={current} />
      </Carousel>
      {!isLoading && (
        <>
          <NextStepButton
            form={form}
            current={current}
            count={count}
            onNext={() => cApi?.scrollNext()}
          />
          <p className="m-2 text-center font-bold text-lg italic opacity-30">
            Step {current} / {count}
          </p>
        </>
      )}
    </>
  );
};

/** Banner heading one step of the registration carousel */
const StepBanner: React.FC<{ alt: string; src: string }> = ({ alt, src }) => (
  <div className="flex w-full justify-center">
    <div className="relative aspect-[491/89] w-full">
      <Image alt={alt} src={src} fill className="object-contain" priority={true} />
    </div>
  </div>
);

/** Step 1: username and gender */
const IdentityStep: React.FC<{ form: RegisterFormApi }> = ({ form }) => {
  // Handle username changes
  const watchUsername = useWatch({
    control: form.control,
    name: "username",
    defaultValue: "",
  });

  const debouncedUsername = useDebouncedValue(watchUsername);

  // Checking for unique username
  const { data: databaseUsername } = api.profile.getUsername.useQuery(
    { username: debouncedUsername },
    { enabled: debouncedUsername.length >= 2 && watchUsername === debouncedUsername },
  );

  // If selected username found in database, set error. If not, clear error.
  useEffect(() => {
    const usernameError = form.getFieldState("username").error;
    if (watchUsername === debouncedUsername && databaseUsername) {
      if (!usernameError) {
        form.setError("username", {
          type: "custom",
          message: "The selected username already exists in the database",
        });
      }
    } else if (usernameError?.type === "custom") {
      form.clearErrors("username");
    }
  }, [watchUsername, debouncedUsername, databaseUsername, form]);

  return (
    <div className="flex w-full flex-wrap items-center gap-4 px-10">
      <p className="w-full basis-full text-center font-bold">
        You can only have two accounts per person.
      </p>
      <FormField
        control={form.control}
        name="username"
        render={({ field }) => (
          <FormItem className="w-full basis-full">
            <FormLabel>Select username</FormLabel>
            <FormControl>
              <Input className="h-14 text-3xl" {...field} placeholder="ninja name" />
            </FormControl>
            <div className="flex flex-row">
              <FormDescription className="grow">Public display name.</FormDescription>
              <FormMessage />
            </div>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="gender"
        render={({ field }) => (
          <div className="flex w-full flex-row items-center">
            <FormItem className="w-full">
              <FormLabel>Select gender</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger className="h-14 text-3xl">
                    <SelectValue placeholder={`None`} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {genders.map((gender, i) => (
                    <SelectItem key={`${gender}-${i}`} value={gender}>
                      {gender}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-row">
                <FormDescription className="grow">Gender of your ninja</FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          </div>
        )}
      />
    </div>
  );
};

/** Preview unsaved body, colour and trait choices through the same resolver as saved characters. */
const AppearanceStep: React.FC<{ form: RegisterFormApi }> = ({ form }) => {
  const [gender, hair, eyes, skin, body] = useWatch({
    control: form.control,
    name: ["gender", "hair_color", "eye_color", "skin_color", "spriteBodyStyle"],
  });
  const [watchAttr1, watchAttr2, watchAttr3] = useWatch({
    control: form.control,
    name: ["attribute_1", "attribute_2", "attribute_3"],
  });

  // Options used for select fields
  const option_colors = React.useMemo(
    () =>
      colors.map((color, i) => (
        <SelectItem key={`${color}-${i}`} value={color}>
          {color}
        </SelectItem>
      )),
    [],
  );
  const option_skins = React.useMemo(
    () =>
      skin_colors.map((color, i) => (
        <SelectItem key={`${color}-${i}`} value={color}>
          {color}
        </SelectItem>
      )),
    [],
  );

  return (
    <div className="grid grid-cols-1 items-start gap-3 px-3 sm:grid-cols-[min(9rem,30%)_minmax(0,1fr)]">
      <CharacterPreview
        className="w-40 sm:row-span-2 sm:w-full"
        user={{
          gender,
          spriteBodyStyle: body,
          attributes: [
            watchAttr1,
            watchAttr2,
            watchAttr3,
            `${hair} hair`,
            `${eyes} eyes`,
            `${skin} skin`,
          ].filter((value): value is string => !!value),
        }}
      />
      <FormField
        control={form.control}
        name="spriteBodyStyle"
        render={({ field }) => (
          <FormItem className="min-w-0 gap-1 self-center">
            <FormLabel>Body style</FormLabel>
            <Select
              value={field.value ?? (gender === "Female" ? "female" : "male")}
              onValueChange={field.onChange}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="male">Broad build</SelectItem>
                <SelectItem value="female">Slender build</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        {(
          [
            ["hair_color", "Hair color", option_colors],
            ["eye_color", "Eye color", option_colors],
            ["skin_color", "Skin color", option_skins],
          ] as const
        ).map(([name, label, options]) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem className="min-w-0 gap-1">
                <FormLabel>{label}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={`None`} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>{options}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}

        {(["attribute_1", "attribute_2", "attribute_3"] as const).map((name, slot) => {
          const otherChoices = [watchAttr1, watchAttr2, watchAttr3].filter(
            (_, other) => other !== slot,
          );
          return (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className="min-w-0 gap-1">
                  <FormLabel>Trait {slot + 1}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={`None`} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {attributes
                        .filter(
                          (e) =>
                            !otherChoices.some(
                              (chosen) =>
                                chosen && getAttributeGroup(e).includes(chosen),
                            ),
                        )
                        .map((attribute, i) => (
                          <SelectItem key={`${attribute}-${i}`} value={attribute}>
                            {attribute}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}
        {[watchAttr1, watchAttr2, watchAttr3].includes("Bald") && (
          <p className="text-muted-foreground col-span-2 text-sm sm:col-span-3">
            Bald hides scalp hair; hair color still applies to beards.
          </p>
        )}
      </div>
    </div>
  );
};

/** Step 3: starting bloodline */
const BloodlineStep: React.FC<{ form: RegisterFormApi }> = ({ form }) => {
  // Fetch D-ranked bloodlines
  const { data: bloodlines } = api.bloodline.getAll.useInfiniteQuery(
    { rank: "D", hidden: false, limit: 500 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const allBloodlines = React.useMemo(() => {
    return bloodlines?.pages
      .flatMap((page) => page.data)
      .map((bloodline) => ({
        ...bloodline,
        type: "bloodline" as const,
        description: "",
      }));
  }, [bloodlines]);

  return (
    <div className="flex flex-col gap-4 px-10">
      <div className="font-semibold text-lg">Pick a starting bloodline</div>
      <FormField
        control={form.control}
        name="bloodlineId"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <div>
                {allBloodlines && allBloodlines.length > 0 ? (
                  <ActionSelector
                    items={allBloodlines}
                    selectedId={field.value}
                    onClick={(bloodlineId) => {
                      field.onChange(bloodlineId);
                    }}
                    showLabels
                    emptyText="No D-ranked bloodlines available"
                    showInfoIcon
                    gridClassNameOverwrite="grid grid-cols-4"
                  />
                ) : (
                  <div className="py-4 text-center">Loading bloodlines...</div>
                )}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
};

/** Step 4: agreements and submit */
const AgreementStep: React.FC<{
  form: RegisterFormApi;
  failureMessage: string | undefined;
}> = ({ form, failureMessage }) => (
  <>
    <div className="px-10">
      <FormField
        control={form.control}
        name="read_tos"
        render={({ field }) => (
          <FormItem className="flex flex-row space-x-3 space-y-0 p-4">
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel>
                <Link
                  className="text-base hover:opacity-70 sm:text-lg"
                  href="https://app.termly.io/document/terms-of-service/71d95c2f-d6eb-4e3c-b480-9f0b9bb87830"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {" "}
                  I have read & agree to the Terms of Service
                </Link>
              </FormLabel>
              <FormMessage />
            </div>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="read_privacy"
        render={({ field }) => (
          <FormItem className="flex flex-row space-x-3 space-y-0 p-4">
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel>
                <Link
                  className="text-base hover:opacity-70 sm:text-lg"
                  href="https://app.termly.io/document/privacy-policy/9fea0bba-1061-47c0-8f28-0f724f06cc0e"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  I have read & agree to the Privacy Policy
                </Link>
              </FormLabel>
              <FormMessage />
            </div>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="read_earlyaccess"
        render={({ field }) => (
          <FormItem className="flex flex-row space-x-3 space-y-0 p-4">
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel className="text-base sm:text-lg">
                I accept that this is a constantly changing game
              </FormLabel>
              <FormDescription>
                Things (even if purchased with real money) may radically change over
                time
              </FormDescription>
              <FormMessage />
            </div>
          </FormItem>
        )}
      />
    </div>
    <div className="flex w-full flex-col gap-4 px-10">
      {failureMessage && (
        <p
          role="alert"
          className="border-destructive rounded-md border-2 p-3 text-center font-bold"
        >
          {failureMessage}
        </p>
      )}
      <Button
        id="create"
        type="submit"
        className="w-full animate-[wiggle_1s_ease-in-out_infinite]"
        decoration="gold"
        size="xl"
        animation="pulse"
      >
        <MonitorPlay className="mr-2 h-7 w-7" />
        Create & Start
      </Button>
    </div>
  </>
);

/** Carousel arrow to the next step, enabled once the current step's fields are valid */
const StepGatedCarouselNext: React.FC<{ form: RegisterFormApi; current: number }> = ({
  form,
  current,
}) => {
  const isReady = useIsStepReady(form, current);
  return (
    <CarouselNext
      disabled={!isReady}
      className={cn(isReady && "animate-[wiggle_1s_ease-in-out_infinite]")}
    />
  );
};

/** Button to the next step, shown once the current step's fields are valid */
const NextStepButton: React.FC<{
  form: RegisterFormApi;
  current: number;
  count: number;
  onNext: () => void;
}> = ({ form, current, count, onNext }) => {
  const isReady = useIsStepReady(form, current);
  if (!isReady || current >= count) return null;
  return (
    <div className="flex justify-end p-3 sm:p-4">
      <Button
        type="button"
        onClick={onNext}
        className="bg-green-700 shadow-md hover:bg-green-800"
      >
        Next
        <ArrowRight className="ml-2 h-5 w-5" />
      </Button>
    </div>
  );
};

/** Whether the one-based current step's fields are filled and valid */
const useIsStepReady = (form: RegisterFormApi, current: number) => {
  const [
    watchUsername,
    watchGender,
    watchHairColor,
    watchEyeColor,
    watchSkinColor,
    watchAttr1,
    watchAttr2,
    watchAttr3,
    watchBloodlineId,
  ] = useWatch({
    control: form.control,
    name: [
      "username",
      "gender",
      "hair_color",
      "eye_color",
      "skin_color",
      "attribute_1",
      "attribute_2",
      "attribute_3",
      "bloodlineId",
    ],
  });
  const { errors } = useFormState({ control: form.control });
  const readiness = registrationStepReadiness(
    {
      username: watchUsername,
      gender: watchGender,
      hair_color: watchHairColor,
      eye_color: watchEyeColor,
      skin_color: watchSkinColor,
      attribute_1: watchAttr1,
      attribute_2: watchAttr2,
      attribute_3: watchAttr3,
      bloodlineId: watchBloodlineId,
    },
    Object.keys(errors),
  );
  return readiness[current - 1] ?? false;
};

/** The reason a settled submission failed, in words the player can act on */
const getFailureMessage = (
  data: { success: boolean; message: string } | undefined,
  error: { message: string } | null,
) => {
  if (error) {
    return isRetryableTrpcError(error)
      ? "We could not confirm whether your character was created. Refresh the page to check before trying again."
      : error.message;
  }
  return data && !data.success ? data.message : undefined;
};

/** Helper to get boolean from localStorage with default */
const getLocalStorageBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = safeLocalStorageGetItem(key);
  if (value === null) return defaultValue;
  return value === "true";
};

/** Helper to get randomized initial form values */
const getRandomizedFormValues = () => {
  const shuffledAttributes = shuffle(attributes);
  const [attr1, attr2, attr3] = shuffledAttributes
    .filter(
      (attribute, index, all) =>
        !all
          .slice(0, index)
          .some((previous) => getAttributeGroup(attribute).includes(previous)),
    )
    .slice(0, 3);

  return {
    attribute_1: attr1 ?? attributes[0],
    attribute_2: attr2 ?? attributes[1],
    attribute_3: attr3 ?? attributes[2],
    hair_color: getRandomElement(colors) ?? colors[0],
    eye_color: getRandomElement(colors) ?? colors[0],
    skin_color: getRandomElement(skin_colors) ?? skin_colors[0],
    gender: genders[secureRandomInt(genders.length)] ?? genders[0],
  };
};

type RegisterFormApi = UseFormReturn<
  z.input<typeof registrationSchema>,
  unknown,
  RegistrationSchema
>;

export default Register;
