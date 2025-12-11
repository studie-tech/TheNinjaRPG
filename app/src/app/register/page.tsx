"use client";

import { useState, useEffect } from "react";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import {
  Form,
  FormControl,
  FormLabel,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { MonitorPlay } from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { registrationSchema } from "@/validators/register";
import { attributes } from "@/validators/register";
import { colors, skin_colors } from "@/validators/register";
import { genders } from "@/validators/register";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import { sendGTMEvent } from "@next/third-parties/google";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ActionSelector } from "@/layout/CombatActions";
import {
  IMG_REGISTRATIN_STEP1,
  IMG_REGISTRATIN_STEP2,
  IMG_REGISTRATIN_STEP8,
  IMG_REGISTRATIN_STEP9,
} from "@/drizzle/constants";
import type { CarouselApi } from "@/components/ui/carousel";
import type { RegistrationSchema } from "@/validators/register";

const Register: React.FC = () => {
  // Carousel state
  const [cApi, setCApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  // Router
  const router = useRouter();

  // tRPC utility
  const utils = api.useUtils();

  // User data
  const { data: userData, status: userStatus } = useUserData();

  // Create avatar mutation
  const createAvatar = api.avatar.createAvatar.useMutation();

  // Fetch D-ranked bloodlines
  const { data: bloodlines } = api.bloodline.getAll.useInfiniteQuery(
    { rank: "D", hidden: false, limit: 500 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );
  const allBloodlines = bloodlines?.pages
    .map((page) => page.data)
    .flat()
    .map((bloodline) => ({
      ...bloodline,
      type: "bloodline" as const,
      description: "",
    }));

  // Create character mutation
  const { mutate: createCharacter, isPending } =
    api.register.createCharacter.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          createAvatar.mutate();
          sendGTMEvent({ event: "register", userId: userData?.userId ?? "" });
        }
      },
    });

  // Prepare initial randomized defaults for style-related fields
  const validAttributes = attributes.filter(
    (attr) => attr && attr.toLowerCase() !== "none" && attr.trim() !== "",
  );
  const shuffledAttributes = [...validAttributes].sort(() => 0.5 - Math.random());
  const [initialAttr1, initialAttr2, initialAttr3] = shuffledAttributes.slice(0, 3);

  const validColors = colors.filter(
    (color) => color && color.toLowerCase() !== "none" && color.trim() !== "",
  );
  const validSkinColors = skin_colors.filter(
    (color) => color && color.toLowerCase() !== "none" && color.trim() !== "",
  );
  const validGenders = genders.filter(
    (gender) => gender && gender.toLowerCase() !== "none" && gender.trim() !== "",
  );

  const initialHairColor = validColors[Math.floor(Math.random() * validColors.length)]!;
  const initialEyeColor = validColors[Math.floor(Math.random() * validColors.length)]!;
  const initialSkinColor =
    validSkinColors[Math.floor(Math.random() * validSkinColors.length)]!;
  const initialGender = validGenders[Math.floor(Math.random() * validGenders.length)]!;

  // Get unsigned user settings from localStorage
  const getLocalStorageBoolean = (key: string, defaultValue: boolean): boolean => {
    const saved = safeLocalStorageGetItem(key);
    if (saved !== null) {
      return JSON.parse(saved) as boolean;
    }
    return defaultValue;
  };

  // Form handling
  const form = useForm<RegistrationSchema>({
    mode: "all",
    reValidateMode: "onChange",
    criteriaMode: "all",
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      username: "",
      gender: initialGender,
      hair_color: initialHairColor,
      eye_color: initialEyeColor,
      skin_color: initialSkinColor,
      attribute_1: initialAttr1,
      attribute_2: initialAttr2,
      attribute_3: initialAttr3,
      bloodlineId: undefined,
      musicOn: getLocalStorageBoolean("musicOn", true),
      sfxOn: getLocalStorageBoolean("sfxOn", true),
    },
  });

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

  // If we have userdata, we should not be here
  useEffect(() => {
    if (userStatus === "success" && userData) {
      void router.push("/");
    }
  }, [router, userStatus, userData]);

  // If we are still trying to load user data
  if (userStatus === "pending" || (userStatus === "success" && userData)) {
    return <Loader explanation="Loading page..." />;
  }

  // Handle form submit
  const handleCreateCharacter = form.handleSubmit(
    (data) => createCharacter(data),
    (error) => showFormErrorsToast(error),
  );

  // Options used for select fields
  const option_colors = colors.map((color, index) => (
    <SelectItem key={index} value={color}>
      {color}
    </SelectItem>
  ));
  const option_skins = skin_colors.map((color, index) => (
    <SelectItem key={index} value={color}>
      {color}
    </SelectItem>
  ));

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
                    <div className="w-full flex justify-center">
                      <div className="relative w-full aspect-[491/89]">
                        <Image
                          alt="step1"
                          src={IMG_REGISTRATIN_STEP1}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap w-full gap-4 items-center px-10">
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
                          <div className="flex flex-row items-center w-full">
                            <FormItem className="w-full">
                              <FormLabel>Select gender</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value ?? ""}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-14 text-3xl ">
                                    <SelectValue placeholder={`None`} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {genders.map((gender, index) => (
                                    <SelectItem key={index} value={gender}>
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
                  <CarouselItem className="flex flex-col gap-4 relative">
                    <div className="w-full flex justify-center">
                      <div className="relative w-full aspect-[491/89]">
                        <Image
                          alt="step2"
                          src={IMG_REGISTRATIN_STEP2}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 w-full gap-4 items-center px-3">
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
                                <SelectTrigger className="h-14 text-xl ">
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
                                <SelectTrigger className="h-14 text-xl ">
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
                                <SelectTrigger className="h-14 text-xl ">
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
                    <div className="grid grid-cols-3 w-full gap-4 items-center px-3">
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
                                  .map((attribute, index) => (
                                    <SelectItem key={index} value={attribute}>
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
                                  .map((attribute, index) => (
                                    <SelectItem key={index} value={attribute}>
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
                                  .map((attribute, index) => (
                                    <SelectItem key={index} value={attribute}>
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
                    <div className="w-full flex justify-center">
                      <div className="relative w-full aspect-[491/89]">
                        <Image
                          alt="step3"
                          src={IMG_REGISTRATIN_STEP8}
                          fill
                          className="object-contain"
                          priority={true}
                        />
                      </div>
                    </div>
                    <div className="px-10 flex flex-col gap-4">
                      <div className="text-lg font-semibold">
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
                                  <div className="text-center py-4">
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
                    <div className="w-full flex justify-center">
                      <div className="relative w-full aspect-[491/89]">
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
                                  className="hover:opacity-70 text-base sm:text-lg"
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
                                  className="hover:opacity-70 text-base sm:text-lg"
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
                    className="shadow-md bg-green-700 hover:bg-green-800"
                  >
                    Next
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Button>
                </div>
              )}
            </form>
          </Form>

          <p className="text-center text-lg italic opacity-30 font-bold m-2">
            Step {current} / {count}
          </p>
        </>
      )}
      {isPending && <Loader explanation="Creating character..." />}
    </ContentBox>
  );
};

export default Register;
