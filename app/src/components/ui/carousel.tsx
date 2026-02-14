import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import * as React from "react";
import { use } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/libs/shadui";

type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];

type CarouselProps = {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: ReturnType<typeof useEmblaCarousel>[1];
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
} & CarouselProps;

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const context = use(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
}

interface CarouselComponentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    CarouselProps {
  ref?: React.Ref<HTMLDivElement>;
}

const Carousel = ({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ref,
  ...props
}: CarouselComponentProps) => {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    plugins,
  );
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const onSelect = React.useCallback((api: CarouselApi) => {
    if (!api) {
      return;
    }

    setCanScrollPrev(api.canScrollPrev());
    setCanScrollNext(api.canScrollNext());
  }, []);

  const scrollPrev = React.useCallback(() => {
    api?.scrollPrev();
  }, [api]);

  const scrollNext = React.useCallback(() => {
    api?.scrollNext();
  }, [api]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollNext();
      } else if (event.key === "Enter") {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext],
  );

  React.useEffect(() => {
    if (!api || !setApi) {
      return;
    }

    setApi(api);
  }, [api, setApi]);

  React.useEffect(() => {
    if (!api) {
      return;
    }

    onSelect(api);
    api.on("reInit", onSelect);
    api.on("select", onSelect);

    return () => {
      api?.off("select", onSelect);
    };
  }, [api, onSelect]);

  return (
    <CarouselContext
      value={{
        carouselRef,
        api: api,
        opts,
        orientation: orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
      }}
    >
      <section
        ref={ref}
        onKeyDownCapture={handleKeyDown}
        className={cn("relative", className)}
        aria-label="carousel"
        {...props}
      >
        {children}
      </section>
    </CarouselContext>
  );
};
Carousel.displayName = "Carousel";

interface CarouselContentProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

const CarouselContent = ({ ref, className, ...props }: CarouselContentProps) => {
  const { carouselRef } = useCarousel();

  return (
    <div ref={carouselRef} className="overflow-hidden">
      <div ref={ref} className={cn("flex", className)} {...props} />
    </div>
  );
};
CarouselContent.displayName = "CarouselContent";

const CarouselItem = ({ ref, className, ...props }: CarouselContentProps) => {
  return (
    <article
      ref={ref}
      aria-roledescription="slide"
      className={cn("min-w-0 shrink-0 grow-0 basis-full", className)}
      {...props}
    />
  );
};
CarouselItem.displayName = "CarouselItem";

interface CarouselButtonProps extends React.ComponentProps<typeof Button> {
  ref?: React.Ref<HTMLButtonElement>;
}

const CarouselPrevious = ({
  ref,
  className,
  variant = "outline",
  size = "icon",
  ...props
}: CarouselButtonProps) => {
  const { scrollPrev, canScrollPrev } = useCarousel();
  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size}
      className={cn(
        "absolute h-14 w-14 rounded-full",
        "top-12 left-2 -translate-y-1/2",
        !canScrollPrev && "hidden",
        className,
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ArrowLeft className="h-9 w-9 text-black" />
      <span className="sr-only">Previous slide</span>
    </Button>
  );
};
CarouselPrevious.displayName = "CarouselPrevious";

const CarouselNext = ({
  ref,
  className,
  variant = "outline",
  size = "icon",
  ...props
}: CarouselButtonProps) => {
  const { scrollNext, canScrollNext } = useCarousel();
  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size}
      className={cn(
        "absolute h-14 w-14 rounded-full",
        "top-12 right-2 -translate-y-1/2",
        !canScrollNext && "hidden",
        className,
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ArrowRight className="h-9 w-9 text-black" />
      <span className="sr-only">Next slide</span>
    </Button>
  );
};
CarouselNext.displayName = "CarouselNext";

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
};
