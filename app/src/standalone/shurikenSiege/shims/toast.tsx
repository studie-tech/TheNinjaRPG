import { toast } from "@/components/ui/use-toast";

/** Stands in for the app's toasts: the game only reports a result's message. */
export const showMutationToast = (result: { success: boolean; message: string }) => {
  toast({
    variant: result.success ? "default" : "destructive",
    description: result.message,
  });
};
