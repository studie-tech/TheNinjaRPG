"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { ContentDetails } from "@/hooks/useContentDetails";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { capitalizeFirstLetter } from "@/utils/string";

/** Details dialog of one content row, loaded once `id` is selected. */
export const ContentDetailsModal: React.FC<ContentDetailsModalProps> = (props) => {
  const { type, canEdit, ...modalProps } = props;
  switch (type) {
    case "jutsu":
      return <JutsuDetails {...modalProps} />;
    case "item":
      return <ItemDetails {...modalProps} />;
    case "bloodline":
      return <BloodlineDetails {...modalProps} />;
    case "skillTree":
      return <SkillTreeDetails {...modalProps} canEdit={canEdit} />;
  }
};

/** Bind the jutsu query and statistics view without dynamically selecting a query hook. */
const JutsuDetails: React.FC<ModalProps> = (props) => {
  const { id } = props;
  const query = api.jutsu.get.useQuery({ id }, { enabled: !!id });
  return (
    <DetailsDialog
      {...props}
      title="Jutsu Details"
      label="jutsu"
      query={query}
      render={(item) => <ItemWithEffects item={item} showStatistic="jutsu" />}
    />
  );
};

/** Load the selected item with its item-specific statistics view. */
const ItemDetails: React.FC<ModalProps> = (props) => {
  const { id } = props;
  const query = api.item.get.useQuery({ id }, { enabled: !!id });
  return (
    <DetailsDialog
      {...props}
      title="Item Details"
      label="item"
      query={query}
      render={(item) => <ItemWithEffects item={item} showStatistic="item" />}
    />
  );
};

/** Load the selected bloodline with its bloodline-specific statistics view. */
const BloodlineDetails: React.FC<ModalProps> = (props) => {
  const { id } = props;
  const query = api.bloodline.get.useQuery({ id }, { enabled: !!id });
  return (
    <DetailsDialog
      {...props}
      title="Bloodline Details"
      label="bloodline"
      query={query}
      render={(item) => <ItemWithEffects item={item} showStatistic="bloodline" />}
    />
  );
};

/** Load the selected skill and expose its editor shortcut only when permitted. */
const SkillTreeDetails: React.FC<ModalProps & { canEdit?: boolean }> = (props) => {
  const { id, canEdit, ...modalProps } = props;
  const query = api.skillTree.get.useQuery({ id }, { enabled: !!id });
  return (
    <DetailsDialog
      {...modalProps}
      title="Skill Details"
      label="skill"
      query={query}
      render={(item) => (
        <ItemWithEffects item={item} showEdit={canEdit ? "skillTree" : undefined} />
      )}
    />
  );
};

/** Keep loaded details visible while providing retry and settled not-found states. */
const DetailsDialog = <T,>(props: DetailsDialogProps<T>) => {
  const { title, label, query, isOpen, setIsOpen, render } = props;
  const { data, isPending, isError, isFetching, refetch } = query;
  return (
    <Modal title={title} isOpen={isOpen} setIsOpen={setIsOpen} proceed_label={null}>
      {isPending ? (
        <Loader explanation={`Loading ${label} details`} />
      ) : (
        data && render(data)
      )}
      {isError && (
        <div className="space-y-2">
          <p role="alert">
            {capitalizeFirstLetter(label)} details could not be loaded. Please try
            again.
          </p>
          <Button disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Retrying..." : "Retry"}
          </Button>
        </div>
      )}
      {!isPending && !isError && !data && (
        <p role="alert">This {label} could not be found.</p>
      )}
    </Modal>
  );
};

type ModalProps = Pick<ContentDetails, "id" | "isOpen" | "setIsOpen">;

interface ContentDetailsModalProps extends ModalProps {
  type: "jutsu" | "item" | "bloodline" | "skillTree";
  /** Offer the edit shortcut on skill tree details. */
  canEdit?: boolean;
}

interface DetailsDialogProps<T> extends Pick<ModalProps, "isOpen" | "setIsOpen"> {
  title: string;
  label: string;
  query: {
    data: T | null | undefined;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
  render: (data: T) => React.ReactNode;
}
