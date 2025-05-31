import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
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
import {
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
} from "@/drizzle/constants";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { effectFilters } from "@/libs/train";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { searchJutsuSchema } from "@/validators/jutsu";
import { Filter } from "lucide-react";
import type { SearchJutsuSchema } from "@/validators/jutsu";
import type { EffectType } from "@/libs/train";
import type { ItemRarity, ItemSlotType, ItemType } from "@/drizzle/schema";

interface ItemShopFilteringProps {
  state: ItemShopFilteringState;
  defaultType: ItemType;
  restrictTypes?: ItemType[];
}

const ItemShopFiltering: React.FC<ItemShopFilteringProps> = (props) => {
  // Destructure the state
  const { setName, setEffect, setItemType } = props.state;
  const { setRarity, setSlot } = props.state;

  const { itemRarity, slot, itemType } = props.state;
  const { name, effect } = props.state;

  // Get available item types
  let categories = Object.values(ItemTypes);
  if (props.restrictTypes) categories = categories.filter((t) => props.restrictTypes?.includes(t));

  // Name search schema
  const form = useForm<SearchJutsuSchema>({
    resolver: zodResolver(searchJutsuSchema),
    defaultValues: { name: name },
  });
  const watchName = useWatch({ control: form.control, name: "name", defaultValue: "" });

  // Update the state
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setName(watchName);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchName, setName]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id="filter-item">
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* Item Type */}
          <div>
            <Select onValueChange={(e) => setItemType(e as ItemType)} value={itemType}>
              <Label htmlFor="rank">Type</Label>
              <SelectTrigger>
                <SelectValue placeholder={itemType} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* item NAME */}
          <div>
            <Form {...form}>
              <Label htmlFor="rank">Name</Label>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="name" placeholder="Search item" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
          {/* Effect */}
          <div>
            <Select onValueChange={(e) => setEffect(e as EffectType)}>
              <Label htmlFor="rank">Effect</Label>
              <SelectTrigger>
                <SelectValue placeholder={effect} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"Any-effect"} value={"ANY"}>
                  ANY
                </SelectItem>
                {effectFilters.map((ef) => (
                  <SelectItem key={ef} value={ef}>
                    {ef}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Rarity */}
          <div>
            <Select onValueChange={(e) => setRarity(e as ItemRarity)}>
              <Label htmlFor="rank">Rarity</Label>
              <SelectTrigger>
                <SelectValue placeholder={itemRarity} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"Any-rarirty"} value="ANY">
                  ANY
                </SelectItem>
                {ItemRarities.map((ir) => (
                  <SelectItem key={ir} value={ir}>
                    {ir}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Slot */}
          <div>
            <Select onValueChange={(e) => setSlot(e as ItemSlotType)}>
              <Label htmlFor="rank">Slot</Label>
              <SelectTrigger>
                <SelectValue placeholder={slot} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"Any-slot"} value="ANY">
                  ANY
                </SelectItem>
                {ItemSlotTypes.map((ir) => (
                  <SelectItem key={ir} value={ir}>
                    {ir}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export { ItemShopFiltering };

/** tRPC filter to be used on api.item.getAll */
export const getShopFilter = (state: ItemShopFilteringState) => {
  return {
    name: state.name ? state.name : undefined,
    itemRarity: state.itemRarity !== "ANY" ? state.itemRarity : undefined,
    slot: state.slot !== "ANY" ? state.slot : undefined,
    effect: state.effect !== "ANY" ? state.effect : undefined,
    itemType: state.itemType,
    onlyInShop: true, // Always ensure onlyInShop is true
  };
};

/** State for the item shop Filtering component */
export const useShopFiltering = (defaultType: ItemType) => {
  // State variables
  const [name, setName] = useState<string>("");
  const [itemRarity, setRarity] = useState<(typeof ItemRarities)[number] | "ANY">("ANY");
  const [effect, setEffect] = useState<(typeof effectFilters)[number] | "ANY">("ANY");
  const [slot, setSlot] = useState<(typeof ItemSlotTypes)[number] | "ANY">("ANY");
  const [itemType, setItemType] = useState<ItemType>(defaultType);

  // Return all
  return {
    effect,
    itemRarity,
    name,
    setEffect,
    setName,
    setRarity,
    setSlot,
    setItemType,
    slot,
    itemType,
  };
};

/** State type */
export type ItemShopFilteringState = ReturnType<typeof useShopFiltering>; 