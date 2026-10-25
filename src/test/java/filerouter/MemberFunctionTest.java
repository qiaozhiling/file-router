package filerouter;

public class MemberFunctionTest extends Thread {

    public MemberFunctionTest(String name) {
        super(name);
    }

    public static class A {
        public int id;

        A(int id) {
            this.id = id;
        }

        synchronized public void feed(String name) throws InterruptedException {
            System.out.println("Thread " + name + " start");
            wait(1000L);
            System.out.println("Thread " + name + " end");
        }
    }

    A a = new A(1);

    public static void main(String[] args) throws Exception {
        MemberFunctionTest memberFunctionTest1 = new MemberFunctionTest("t1");
        MemberFunctionTest memberFunctionTest2 = new MemberFunctionTest("t2");
        memberFunctionTest1.start();
        memberFunctionTest2.start();
    }

    @Override
    public void run() {
        try {
            a.feed(this.getName());
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
    }
}