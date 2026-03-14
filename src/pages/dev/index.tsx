import { OpenClawConnection } from "@/pages/dashboard/components";
import { STTProviders } from "./components";
import Contribute from "@/components/Contribute";
import { useSettings } from "@/hooks";
import { PageLayout } from "@/layouts";

const DevSpace = () => {
  const settings = useSettings();

  return (
    <PageLayout title="Dev Space" description="Manage your dev space">
      <Contribute />
      {/* OpenClaw connection (AI is OpenClaw-only) */}
      <OpenClawConnection />
      {/* STT Providers */}
      <STTProviders {...settings} />
    </PageLayout>
  );
};

export default DevSpace;
