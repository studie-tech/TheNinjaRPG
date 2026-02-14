"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendGTMEvent } from "@next/third-parties/google";
import { ArrowRight, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import {
  attributes,
  colors,
  genders,
  registrationSchema,
  skin_colors,
} from "@/validators/register";

/**
 * Wrapper component that handles the loading state and authenticated user redirect.
 * This separation ensures consistent hook counts in the form component.
 */
const Register: React.FC = () => {
  const router = useRouter();
  const { data: userData, status: userStatus } = useUserData();

  // Redirect authenticated users away from register page
  useEffect(() => {
    if (userStatus === "success" && userData) {
      void router.push("/");
    }
  }, [router, userStatus, userData]);

  // Show loader while checking auth status or if user is authenticated
  if (userStatus === "pending" || (userStatus === "success" && userData)) {
    return <Loader explanation="Loading page..." />;
  }

  // Only render the form when we're sure the user should see it
  return <RegisterForm />;
};

/** Helper to get boolean from localStorage with default */
const getLocalStorageBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = safeLocalStorageGetItem(key);
  if (value === null) return defaultValue;
  return value === "true";
};

/** Helper to get randomized initial form values */
const getRandomizedFormValues = () => {
  const shuffledAttributes = [...attributes].sort(() => 0.5 - Math.random());
  const [attr1, attr2, attr3] = shuffledAttributes.slice(0, 3);

  return {
    attribute_1: attr1 ?? attributes[0],
    attribute_2: attr2 ?? attributes[1],
    attribute_3: attr3 ?? attributes[2],
    hair_color: colors[Math.floor(Math.random() * colors.length)] ?? colors[0],
    eye_color: colors[Math.floor(Math.random() * colors.length)] ?? colors[0],
    skin_color:
      skin_colors[Math.floor(Math.random() * skin_colors.length)] ?? skin_colors[0],
    gender: genders[Math.floor(Math.random() * genders.length)] ?? genders[0],
  };
};

/**
 * The actual registration form component.
 * Separated from the wrapper to ensure all hooks are called consistently.
 */
const RegisterForm: React.FC = () => {
  // Carousel state
  const [cApi, setCApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  // tRPC utility
  const utils = api.useUtils();

  // User data (for GTM event)
  const { data: userData } = useUserData();

  // Create avatar mutation
  const createAvatar = api.avatar.createAvatar.useMutation();

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

  // Create character mutation
  const { mutate: createCharacter, isPending } =
    api.register.createCharacter.useMutation({
      onSuccess: async (data) => {
        if (data.success) {
          await utils.profile.getUser.invalidate();
          createAvatar.mutate();
          sendGTMEvent({ event: "register", userId: userData?.userId ?? "" });
        } else {
          showMutationToast(data);
        }
      },
    });

  // Prepare initial randomized defaults for style-related fields
  // Using useState with lazy initialization to ensure values are computed only once
  // Note: This runs on client only so randomization is fine (no SSR hydration mismatch)
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
      hair_color: initialFormValues.hair_color,
      eye_color: initialFormValues.eye_color,
      skin_color: initialFormValues.skin_color,
      attribute_1: initialFormValues.attribute_1,
      attribute_2: initialFormValues.attribute_2,
      attribute_3: initialFormValues.attribute_3,
      bloodlineId: undefined,
      musicOn: true,
      sfxOn: true,
    },
  });

  // Set localStorage-based values once mounted (can't access localStorage during SSR/initial render)
  useEffect(() => {
    form.setValue("musicOn", getLocalStorageBoolean("musicOn", true));
    form.setValue("sfxOn", getLocalStorageBoolean("sfxOn", true));
  }, [form]);

  // Carousel control
  useEffect(() => {
    if (!cApi) return;

    setCount(cApi.scrollSnapList().length);
    setCurrent(cApi.selectedScrollSnap() + 1);

    cApi.on("select", () => {
      setCurrent(cApi.selectedScrollSnap() + 1);
    });
  }, [cApi, form]);

  // Handle username changes
  const watchUsername = useWatch({
    control: form.control,
    name: "username",
    defaultValue: "",
  });
  const watchGender = useWatch({
    control: form.control,
    name: "gender",
    defaultValue: undefined,
  });
  const watchAttr1 = useWatch({
    control: form.control,
    name: "attribute_1",
    defaultValue: undefined,
  });
  const watchAttr2 = useWatch({
    control: form.control,
    name: "attribute_2",
    defaultValue: undefined,
  });
  const watchAttr3 = useWatch({
    control: form.control,
    name: "attribute_3",
    defaultValue: undefined,
  });
  const watchHairColor = useWatch({
    control: form.control,
    name: "hair_color",
    defaultValue: undefined,
  });
  const watchEyeColor = useWatch({
    control: form.control,
    name: "eye_color",
    defaultValue: undefined,
  });
  const watchSkinColor = useWatch({
    control: form.control,
    name: "skin_color",
    defaultValue: undefined,
  });
  const watchBloodlineId = useWatch({
    control: form.control,
    name: "bloodlineId",
    defaultValue: undefined,
  });

  const isStep1Ready =
    watchUsername.trim().length >= 2 &&
    Boolean(watchGender) &&
    !form.formState.errors.username &&
    !form.formState.errors.gender;
  const isStep2Ready =
    Boolean(watchHairColor) &&
    Boolean(watchEyeColor) &&
    Boolean(watchSkinColor) &&
    Boolean(watchAttr1) &&
    Boolean(watchAttr2) &&
    Boolean(watchAttr3) &&
    !form.formState.errors.hair_color &&
    !form.formState.errors.eye_color &&
    !form.formState.errors.skin_color &&
    !form.formState.errors.attribute_1 &&
    !form.formState.errors.attribute_2 &&
    !form.formState.errors.attribute_3;
  const isStep3Ready = Boolean(watchBloodlineId) && !form.formState.errors.bloodlineId;
  const canShowNextSmall =
    current === 1
      ? isStep1Ready
      : current === 2
        ? isStep2Ready
        : current === 3
          ? isStep3Ready
          : false;

  // Checking for unique username
  const { data: databaseUsername } = api.profile.getUsername.useQuery(
    { username: watchUsername },
    { enabled: watchUsername.length >= 2 },
  );

  // If selected username found in database, set error. If not, clear error.
  useEffect(() => {
    const usernameError = form.formState.errors.username;
    if (databaseUsername) {
      if (!usernameError) {
        form.setError("username", {
          type: "custom",
          message: "The selected username already exists in the database",
        });
      }
    } else if (usernameError?.type === "custom") {
      form.clearErrors("username");
    }
  }, [watchUsername, databaseUsername, form]);

  // If we have local storage referrer, set it as default value
  useEffect(() => {
    // Recruiter user
    const referrer = safeLocalStorageGetItem("ref");
    if (referrer) {
      form.setValue("recruiter_userid", referrer);
    }
    // Source
    const source = safeLocalStorageGetItem("utm_source");
    if (source) {
      form.setValue("utm_source", source);
    }
  }, [form]);

  // Handle form submission
  const handleCreateCharacter = form.handleSubmit(
    (data) => createCharacter(data),
    (errors) => showFormErrorsToast(errors),
  );

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
    <ContentBox
      title="Create your Ninja"
      subtitle="And unlock the mysteries of Seichi"
      padding={false}
    >
      {!isPending && (
        <>
          <Form {...form}>
            <form onSubmit={handleCreateCharacter} className="relative">
              <Carousel setApi={setCApi}>
                <CarouselContent>
                  <CarouselItem className="flex flex-col gap-4">
                    <div className="flex w-full justify-center">
                      <div className="relative aspect-[491/89] w-full">
                        <Image
                          alt="step1"
                          src={IMG_REGISTRATIN_STEP1}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-4 px-10">
                      <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem className="w-full basis-full">
                            <FormLabel>Select username</FormLabel>
                            <FormControl>
                              <Input
                                className="h-14 text-3xl"
                                {...field}
                                placeholder="ninja name"
                              />
                            </FormControl>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Public display name.
                              </FormDescription>
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
                              <Select
                                onValueChange={field.onChange}
                                value={field.value ?? ""}
                              >
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
                                <FormDescription className="grow">
                                  Gender of your ninja
                                </FormDescription>
                                <FormMessage />
                              </div>
                            </FormItem>
                          </div>
                        )}
                      />
                    </div>
                  </CarouselItem>
                  <CarouselItem className="relative flex flex-col gap-4">
                    <div className="flex w-full justify-center">
                      <div className="relative aspect-[491/89] w-full">
                        <Image
                          alt="step2"
                          src={IMG_REGISTRATIN_STEP2}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-3 items-center gap-4 px-3">
                      <FormField
                        control={form.control}
                        name="hair_color"
                        render={({ field }) => (
                          <FormItem className="basis-1/3">
                            <FormLabel>Hair color</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger className="h-14 text-xl">
                                  <SelectValue placeholder={`None`} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>{option_colors}</SelectContent>
                            </Select>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Attribute 1
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="eye_color"
                        render={({ field }) => (
                          <FormItem className="basis-1/3">
                            <FormLabel>Eye color</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger className="h-14 text-xl">
                                  <SelectValue placeholder={`None`} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>{option_colors}</SelectContent>
                            </Select>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Attribute 2
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="skin_color"
                        render={({ field }) => (
                          <FormItem className="basis-1/3">
                            <FormLabel>Skin color</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger className="h-14 text-xl">
                                  <SelectValue placeholder={`None`} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>{option_skins}</SelectContent>
                            </Select>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Attribute 3
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid w-full grid-cols-3 items-center gap-4 px-3">
                      <FormField
                        control={form.control}
                        name="attribute_1"
                        render={({ field }) => (
                          <FormItem className="basis-1/3">
                            <FormLabel>Attribute #1</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger className="h-14 text-xl">
                                  <SelectValue placeholder={`None`} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {attributes
                                  .filter((e) => ![watchAttr2, watchAttr3].includes(e))
                                  .map((attribute, i) => (
                                    <SelectItem
                                      key={`${attribute}-${i}`}
                                      value={attribute}
                                    >
                                      {attribute}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Customize
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="attribute_2"
                        render={({ field }) => (
                          <FormItem className="basis-1/3">
                            <FormLabel>Attribute #2</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger className="h-14 text-xl">
                                  <SelectValue placeholder={`None`} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {attributes
                                  .filter((e) => ![watchAttr1, watchAttr3].includes(e))
                                  .map((attribute, i) => (
                                    <SelectItem
                                      key={`${attribute}-${i}`}
                                      value={attribute}
                                    >
                                      {attribute}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Customize
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="attribute_3"
                        render={({ field }) => (
                          <FormItem className="basis-1/3">
                            <FormLabel>Attribute #3</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger className="h-14 text-xl">
                                  <SelectValue placeholder={`None`} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {attributes
                                  .filter((e) => ![watchAttr1, watchAttr2].includes(e))
                                  .map((attribute, i) => (
                                    <SelectItem
                                      key={`${attribute}-${i}`}
                                      value={attribute}
                                    >
                                      {attribute}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <div className="flex flex-row">
                              <FormDescription className="grow">
                                Customize
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </CarouselItem>
                  <CarouselItem className="flex flex-col gap-4">
                    <div className="flex w-full justify-center">
                      <div className="relative aspect-[491/89] w-full">
                        <Image
                          alt="step3"
                          src={IMG_REGISTRATIN_STEP8}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 px-10">
                      <div className="font-semibold text-lg">
                        Pick a starting bloodline
                      </div>
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
                                  <div className="py-4 text-center">
                                    Loading bloodlines...
                                  </div>
                                )}
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CarouselItem>
                  <CarouselItem className="flex flex-col items-center gap-4">
                    <div className="flex w-full justify-center">
                      <div className="relative aspect-[491/89] w-full">
                        <Image
                          alt="step4"
                          src={IMG_REGISTRATIN_STEP9}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>
                    <div className="px-10">
                      <FormField
                        control={form.control}
                        name="read_tos"
                        render={({ field }) => (
                          <FormItem className="flex flex-row space-x-3 space-y-0 p-4">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
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
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
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
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="text-base sm:text-lg">
                                I accept that this is a constantly changing game
                              </FormLabel>
                              <FormDescription>
                                Things (even if purchased with real money) may radically
                                change over time
                              </FormDescription>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="w-full px-10">
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
                  </CarouselItem>
                </CarouselContent>
                <CarouselPrevious className="animate-[wiggle_1s_ease-in-out_infinite]" />
                <CarouselNext className="animate-[wiggle_1s_ease-in-out_infinite]" />
              </Carousel>
              {canShowNextSmall && current < count && (
                <div className="absolute right-2 bottom-2 sm:right-4 sm:bottom-4">
                  <Button
                    type="button"
                    onClick={() => cApi?.scrollNext()}
                    className="bg-green-700 shadow-md hover:bg-green-800"
                  >
                    Next
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              )}
            </form>
          </Form>

          <p className="m-2 text-center font-bold text-lg italic opacity-30">
            Step {current} / {count}
          </p>
        </>
      )}
      {isPending && <Loader explanation="Creating character..." />}
    </ContentBox>
  );
};

export default Register;
