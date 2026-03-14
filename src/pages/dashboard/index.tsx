import { OpenClawConnection, ClawConfig } from "./components";
import { STTProviders } from "@/pages/dev/components/stt-configs";
import { useSettings } from "@/hooks";
import { PageLayout } from "@/layouts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const Dashboard = () => {
  const settings = useSettings();

  return (
    <PageLayout
      title="Dashboard"
      description="Configure OpenClaw connection, gateway settings, and speech-to-text."
    >
      <Tabs defaultValue="connection" className="w-full">
        <TabsList>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="claw-config">Claw Config</TabsTrigger>
          <TabsTrigger value="stt">Speech-to-Text</TabsTrigger>
        </TabsList>

        <TabsContent value="connection">
          <OpenClawConnection />
        </TabsContent>

        <TabsContent value="claw-config">
          <ClawConfig />
        </TabsContent>

        <TabsContent value="stt">
          <STTProviders {...settings} />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
};

export default Dashboard;
